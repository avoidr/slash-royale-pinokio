using ClashRoyale.Logic.Home;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Text;
using System.IO;
using ClashRoyale.Extensions.Utils;

namespace ClashRoyale.Core
{
    public class LangConfiguration
    {
        [JsonIgnore]
        public static JsonSerializerSettings JsonSettings = new JsonSerializerSettings
        {
            ObjectCreationHandling = ObjectCreationHandling.Reuse,
            MissingMemberHandling = MissingMemberHandling.Ignore,
            DefaultValueHandling = DefaultValueHandling.Ignore,
            NullValueHandling = NullValueHandling.Ignore,
            TypeNameHandling = TypeNameHandling.Auto,
            Formatting = Formatting.None
        };

        // Make sure to edit these on prod
        [JsonProperty("PlayerJoined")] public string PlrJoined = "Player %PlayerName joined the server";
        [JsonProperty("PlayerDisconnected")] public string PlrConnLost = "Player %PlayerName disconnected";
        [JsonProperty("StartingServer")] public string SrvStarting = "Server is starting, please wait";
        [JsonProperty("ShuttingDownServer")] public string SrvClosing = "Server is shutting down, sorry for inconvenience";
        [JsonProperty("BattleStarted")] public string BattleStarted = "Battle with id %id started";
        [JsonProperty("BattleEnded")] public string BattleEnded = "Battle with id %id ended";
        [JsonProperty("PlayerJoinedBattle")] public string PlayerJoined = "Player %username joined battle with id %id";
        


        /// <summary>
        ///     Loads the configuration
        /// </summary>
        public void Initialize()
        {
            if (File.Exists("lang.json"))
                try
                {
                    var Lang = JsonConvert.DeserializeObject<LangConfiguration>(File.ReadAllText("lang.json"));

                    PlrJoined = Lang.PlrJoined;
                    PlrConnLost = Lang.PlrConnLost;
                    SrvStarting = Lang.SrvStarting;
                    SrvClosing = Lang.SrvClosing;
                    
                }
                catch (Exception)
                {
                    WebhookUtils.SendError(Resources.Configuration.Srv_Webhook, "Failed to load language", "Fatal Error");
                    Console.ReadKey(true);
                    Environment.Exit(0);
                }
            else
                try
                {
                    Save();

                    Console.ForegroundColor = ConsoleColor.DarkGreen;
                    Console.WriteLine("lang configuration has been created. Restart the server now.");
                    Console.ReadKey();
                    Environment.Exit(0);
                }
                catch (Exception)
                {
                    Console.ForegroundColor = ConsoleColor.DarkRed;
                    Console.WriteLine("Couldn't create lang file.");
                    Console.ReadKey();
                    Environment.Exit(0);
                }
        }

        public void Save()
        {
            File.WriteAllText("lang.json", JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }
}
