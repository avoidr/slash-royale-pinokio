using System;
using System.Collections.Generic;
using System.IO;
using ClashRoyale.Logic.Battle;
using ClashRoyale.Logic.Home;
using Newtonsoft.Json;

namespace ClashRoyale.Core
{
    public class Configuration
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
        [JsonProperty("cluster_encryption_key")]
        public string ClusterKey = "15uvmi8qnyuj9tm53ipaavvytltm582yatecyjzb";

        [JsonProperty("cluster_encryption_nonce")]
        public string ClusterNonce = "nonce";

        [JsonProperty("cluster_server_port")] public int ClusterServerPort = 9876;

        [JsonProperty("encryption_key")] public string EncryptionKey = "fhsd6f86f67rt8fw78fw789we78r9789wer6re";

        [JsonProperty("mysql_database")] public string MySqlDatabase = "rrdb";
        [JsonProperty("mysql_password")] public string MySqlPassword = "";
        [JsonProperty("mysql_server")] public string MySqlServer = "127.0.0.1";
        [JsonProperty("mysql_user")] public string MySqlUserId = "root";
        [JsonProperty("patch_url")] public string PatchUrl = "";
        [JsonProperty("sentry_api")] public string SentryApiUrl = "";
        [JsonProperty("server_port")] public int ServerPort = 9339;
        [JsonProperty("update_url")] public string UpdateUrl = "https://github.com/retroroyale/ClashRoyale";
        [JsonProperty("use_content_patch")] public bool UseContentPatch;
        [JsonProperty("MinTrophies")] public int MinTroph = 25;
        [JsonProperty("MaxTrophies")] public int MaxTroph = 34;
        [JsonProperty("DefaultGold")] public int DefGold = 1000;
        [JsonProperty("DefaultGems")] public int DefGems = 1000;
        [JsonProperty("DefaultLevel")] public int DefLevel = 1;
        [JsonProperty("use_udp")] public bool UseUdp = true;
        [JsonProperty("BattleLog_WebhookUrl")] public string BL_Webhook = "";
        [JsonProperty("PlayerLog_WebhookUrl")] public string Plr_Webhook = "";
        [JsonProperty("ServerLog_WebhookUrl")] public string Srv_Webhook = "";
        [JsonProperty("admins")] public List<long> Admins = new List<long>();
        [JsonProperty("banned_ids")] public List<long> BannedIds = new List<long>();
        [JsonProperty("GemsToGiveAfterMatch")] public int gemsreward = 0;
        [JsonProperty("GoldToGiveAfterMatch")] public int goldreward = 20;
        [JsonProperty("ErrorLogWebhook")] public string error_webhook;





        /// <summary>
        ///     Loads the configuration
        /// </summary>
        public void Initialize()
        {
            if (File.Exists("config.json"))
                try
                {
                    var config = JsonConvert.DeserializeObject<Configuration>(File.ReadAllText("config.json"));

                    EncryptionKey = config.EncryptionKey;
                    SentryApiUrl = config.SentryApiUrl;

                    MySqlUserId = config.MySqlUserId;
                    MySqlServer = config.MySqlServer;
                    MySqlPassword = config.MySqlPassword;
                    MySqlDatabase = config.MySqlDatabase;

                    PatchUrl = config.PatchUrl;
                    UseContentPatch = config.UseContentPatch;

                    ServerPort = config.ServerPort;
                    UpdateUrl = config.UpdateUrl;

                    UseUdp = config.UseUdp;
                    ClusterServerPort = config.ClusterServerPort;

                    ClusterKey = config.ClusterKey;
                    ClusterNonce = config.ClusterNonce;
                    LogicBattle.MinTrophies = config.MinTroph;
                    LogicBattle.MaxTrophy = config.MaxTroph;
                    Home.DefaultGems = config.DefGems;
                    Home.DefaultLevel = config.DefLevel;
                    Home.DefaultGold = config.DefGold;
                    Srv_Webhook = config.Srv_Webhook;
                    Plr_Webhook = config.Plr_Webhook;
                    BL_Webhook = config.BL_Webhook;
                    Admins = config.Admins;
                    BannedIds = config.BannedIds;

                    gemsreward = config.gemsreward;
                    goldreward = config.goldreward;
                    error_webhook = config.error_webhook;
                }
                catch (Exception)
                {
                    Console.WriteLine("Couldn't load configuration.");
                    Console.ReadKey(true);
                    Environment.Exit(0);
                }
            else
                try
                {
                    Save();

                    Console.ForegroundColor = ConsoleColor.DarkGreen;
                    Console.WriteLine("Server configuration has been created. Restart the server now.");
                    Console.ReadKey();
                    Environment.Exit(0);
                }
                catch (Exception)
                {
                    Console.ForegroundColor = ConsoleColor.DarkRed;
                    Console.WriteLine("Couldn't create config file.");
                    Console.ReadKey();
                    Environment.Exit(0);
                }
        }

        public void Save()
        {
            File.WriteAllText("config.json", JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }
}
