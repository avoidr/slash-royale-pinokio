"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const dotnet = path.join(
  root,
  "env",
  "dotnet",
  process.platform === "win32" ? "dotnet.exe" : "dotnet"
);

if (!fs.existsSync(dotnet)) {
  console.error("dotnet SDK not found: " + dotnet + " (run Install first)");
  process.exit(2);
}

const sdkDir = path.join(path.dirname(dotnet), "sdk");
if (!fs.existsSync(sdkDir) || fs.readdirSync(sdkDir).filter(f => !f.startsWith('.')).filter(f => fs.statSync(path.join(sdkDir, f)).isDirectory()).length === 0) {
  console.error(".NET SDK not found in " + sdkDir + " (run Install first)");
  process.exit(2);
}

const targets = [
  {
    name: "ClashRoyale (main server)",
    csproj: path.join(root, "server", "SlashRoyale", "src", "ClashRoyale", "ClashRoyale.csproj"),
    out: path.join(root, "server", "publish"),
  },
  {
    name: "ClashRoyale.Battles (battle server)",
    csproj: path.join(root, "server", "SlashRoyale", "src", "ClashRoyale.Battles", "ClashRoyale.Battles.csproj"),
    out: path.join(root, "server", "publish-battles"),
  },
];

for (const t of targets) {
  if (!fs.existsSync(t.csproj)) {
    console.error("missing csproj: " + t.csproj);
    process.exit(2);
  }
  console.log("=== Publishing " + t.name + " ===");
  execFileSync(dotnet, ["publish", t.csproj, "-c", "Release", "-o", t.out], { stdio: "inherit" });
}

// Ensure config.json exists in both publish directories
const defaultConfig = {
  cluster_encryption_key: "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb",
  cluster_encryption_nonce: "nonce",
  cluster_server_port: 9876,
  encryption_key: "fhsd6f86f67rt8fw78fw789we78r9789wer6re",
  mysql_database: "rrdb",
  mysql_password: "",
  mysql_server: "127.0.0.1",
  mysql_user: "root",
  patch_url: "",
  sentry_api: "",
  server_port: 9339,
  server_address: "127.0.0.1",
  update_url: "https://github.com/retroroyale/ClashRoyale",
  use_content_patch: false,
  MinTrophies: 25,
  MaxTrophies: 34,
  DefaultGold: 1000,
  DefaultGems: 1000,
  DefaultLevel: 1,
  // Battle server disabled by default: matches run on the main server over TCP.
  // The UDP battle-server path is currently unusable for remote devices (it hands
  // the client a loopback IP as the battle host), so new installs default to off.
  use_udp: false,
  BattleLog_WebhookUrl: "",
  PlayerLog_WebhookUrl: "",
  ServerLog_WebhookUrl: "",
  admins: [],
  banned_ids: [],
  GemsToGiveAfterMatch: 0,
  GoldToGiveAfterMatch: 20,
  ErrorLogWebhook: ""
};

const battleConfig = {
  battle_nonce: "nonce",
  cluster_encryption_key: "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb",
  cluster_encryption_nonce: "nonce",
  max_sessions: 100,
  sentry_api: "",
  server_port: 9449
};

for (const t of targets) {
  const configPath = path.join(t.out, "config.json");
  if (!fs.existsSync(configPath)) {
    const config = t.name.includes("Battles") ? battleConfig : defaultConfig;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("Created default config.json: " + configPath);
  }
}

console.log("Publish complete.");