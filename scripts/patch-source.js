"use strict";

const fs = require("fs");
const path = require("path");

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    console.error("File not found: " + filePath);
    return false;
  }

  let content = fs.readFileSync(filePath, "utf8");
  let original = content;

  for (const [search, replace] of replacements) {
    content = content.replace(search, replace);
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log("Patched: " + filePath);
    return true;
  } else {
    console.log("No changes needed: " + filePath);
    return false;
  }
}

const root = path.resolve(__dirname, "..");
const hashRoyaleSrc = path.join(root, "server", "HashRoyale", "src");

// 1. Configuration.cs - new defaults
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale", "Core", "Configuration.cs"),
  [
    [/\[JsonProperty\("MinTrophies"\)\] public int MinTroph;/g, '[JsonProperty("MinTrophies")] public int MinTroph = 25;'],
    [/\[JsonProperty\("MaxTrophies"\)\] public int MaxTroph;/g, '[JsonProperty("MaxTrophies")] public int MaxTroph = 34;'],
    [/\[JsonProperty\("DefaultGold"\)\] public int DefGold;/g, '[JsonProperty("DefaultGold")] public int DefGold = 1000;'],
    [/\[JsonProperty\("DefaultGems"\)\] public int DefGems;/g, '[JsonProperty("DefaultGems")] public int DefGems = 1000;'],
    [/\[JsonProperty\("DefaultLevel"\)\] public int DefLevel;/g, '[JsonProperty("DefaultLevel")] public int DefLevel = 1;'],
    [/\[JsonProperty\("use_udp"\)\] public bool UseUdp;/g, '[JsonProperty("use_udp")] public bool UseUdp = true;'],
    [/\[JsonProperty\("BattleLog_WebhookUrl"\)\] public string BL_Webhook;/g, '[JsonProperty("BattleLog_WebhookUrl")] public string BL_Webhook = "";'],
    [/\[JsonProperty\("PlayerLog_WebhookUrl"\)\] public string Plr_Webhook;/g, '[JsonProperty("PlayerLog_WebhookUrl")] public string Plr_Webhook = "";'],
    [/\[JsonProperty\("ServerLog_WebhookUrl"\)\] public string Srv_Webhook;/g, '[JsonProperty("ServerLog_WebhookUrl")] public string Srv_Webhook = "";'],
    [/\[JsonProperty\("GemsToGiveAfterMatch"\)\] public int gemsreward;/g, '[JsonProperty("GemsToGiveAfterMatch")] public int gemsreward = 0;'],
    [/\[JsonProperty\("GoldToGiveAfterMatch"\)\] public int goldreward;/g, '[JsonProperty("GoldToGiveAfterMatch")] public int goldreward = 20;'],
  ]
);

// 2. NettyService.cs - fix ErrorLevel import
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale", "Core", "Network", "NettyService.cs"),
  [
    [/using ClashRoyale\.Extensions\.Utils;/g, "using ClashRoyale.Extensions.Utils;\nusing SharpRaven.Data;"],
    [/Logger\.Log\(\$"Netty RunServerAsync failed: \{ex\.Message\}\\n\{ex\.StackTrace\}", GetType\(\), ErrorLevel\.Error\);/g, 'Logger.Log($"Netty RunServerAsync failed: {ex.Message}\\n{ex.StackTrace}", GetType(), ErrorLevel.Error);'],
  ]
);

// 3. Players.cs - add ReloadPlayer and DiscardSave
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale", "Database", "Cache", "Players.cs"),
  [
    [/public readonly object SyncObject = new object\(\);/g, 'public readonly object SyncObject = new object();\n\n        private readonly HashSet<long> _discardSaves = new HashSet<long>();'],
    [/Resources\.ObjectCache\.InvalidatePlayer\(userId\);/g, 'Resources.ObjectCache.UncachePlayer(userId);\n            }\n        }\n\n        /// <summary>\n        ///     Check and clear discard-save flag for a player (admin edit)\n        /// </summary>\n        public bool DiscardSave(long userId)\n        {\n            lock (SyncObject)\n            {\n                if (_discardSaves.Contains(userId))\n                {\n                    _discardSaves.Remove(userId);\n                    return true;\n                }\n                return false;\n            }\n        }'],
  ]
);

// 4. Program.cs - remove Console.Read blocking
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale", "Program.cs"),
  [
    [/using System;\nusing System\.Threading;/g, "using System;\nusing System.Threading;"],
    [/WebhookUtils\.SendNotify\(Resources\.Configuration\.Srv_Webhook, Resources\.LangConfiguration\.SrvStarting, "Server Log"\);\n            if \(ServerUtils\.IsLinux\(\)\)\n            \{\n                \/\/ idk why orginal dev removed this lol\n                Logger\.Log\("Press any key to shutdown the server\.", null\);\n                Console\.Read\(\);\n            }\n            else\n            \{\n                Logger\.Log\("Press any key to shutdown the server\.", null\);\n                \n                Console\.Read\(\);\n            \}\n            Shutdown\(\);\n            WebhookUtils\.SendError\(Resources\.Configuration\.Srv_Webhook, Resources\.LangConfiguration\.SrvClosing, "Server Log"\);/g, 
`WebhookUtils.SendNotify(Resources.Configuration.Srv_Webhook, Resources.LangConfiguration.SrvStarting, "Server Log");
            Logger.Log("Server started successfully. Running...", null);

            var shutdownEvent = new ManualResetEvent(false);
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                shutdownEvent.Set();
            };

            shutdownEvent.WaitOne();
            Shutdown();
            WebhookUtils.SendError(Resources.Configuration.Srv_Webhook, Resources.LangConfiguration.SrvClosing, "Server Log");`]
  ]
);

// 5. ClashRoyale.Battles Program.cs - remove Console.Read blocking
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale.Battles", "Program.cs"),
  [
    [/using System;/g, "using System;\nusing System.Threading;"],
    [/Resources\.Initialize\(\);\n\n            Console\.Read\(\);/g, 
`Resources.Initialize();

            var shutdownEvent = new ManualResetEvent(false);
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                shutdownEvent.Set();
            };

            shutdownEvent.WaitOne();`]
  ]
);

// 6. ClashRoyale.Battles Configuration.cs - remove Console.ReadKey
patchFile(
  path.join(hashRoyaleSrc, "ClashRoyale.Battles", "Core", "Configuration.cs"),
  [
    [/catch \(Exception\)\n                \{\n                    Console\.WriteLine\("Couldn't load configuration\."\);\\n                    Console\.ReadKey\(true\);\n                    Environment\.Exit\(1\);\n                \}/g,
`catch (Exception)
                {
                    Console.WriteLine("Couldn't load configuration.");
                    Environment.Exit(1);
                }`],
    [/try\n                \{\n                    Save\(\);\n\n                    Console\.ForegroundColor = ConsoleColor\.DarkGreen;\n                    Console\.WriteLine\("Server configuration has been created\. Restart the server now\."\);\\n                    Console\.ReadKey\(\);\n                    Environment\.Exit\(0\);\n                \}\n                catch \(Exception\)\n                \{\n                    Console\.ForegroundColor = ConsoleColor\.DarkRed;\n                    Console\.WriteLine\("Couldn't create config file\."\);\\n                    Console\.ReadKey\(\);\n                    Environment\.Exit\(1\);\n                \}/g,
`try
                {
                    Save();

                    Console.ForegroundColor = ConsoleColor.DarkGreen;
                    Console.WriteLine("Server configuration has been created. Restart the server now.");
                    Environment.Exit(0);
                }
                catch (Exception)
                {
                    Console.ForegroundColor = ConsoleColor.DarkRed;
                    Console.WriteLine("Couldn't create config file.");
                    Environment.Exit(1);
                }`]
  ]
);

console.log("All patches applied.");