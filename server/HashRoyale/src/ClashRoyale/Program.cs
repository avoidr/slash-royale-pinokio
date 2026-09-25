using System;
using System.Threading;
using ClashRoyale.Core;
using ClashRoyale.Extensions.Utils;
using ClashRoyale.Utilities.Utils;

namespace ClashRoyale
{
    public static class Program
    {
        private static void Main()
        {
            Console.Title = "SlashRoyale";

            Console.WriteLine("\r\n   _____ __           __    ____                    __\r\n  / ___// /___ ______/ /_  / __ \\____  __  ______ _/ /__\r\n  \\__ \\/ / __ `/ ___/ __ \\/ /_/ / __ \\/ / / / __ `/ / _ \\\r\n ___/ / / /_/ (__  ) / / / _, _/ /_/ / /_/ / /_/ / /  __/\r\n/____/_/\\__,_/____/_/ /_/_/ |_|\\____/\\__, /\\__,_/_/\\___/\r\n                                    /____/   by avoidr\r\n");
            Console.WriteLine("Based on HashRoyale by Hashmane");
            Console.WriteLine("Credits to Hashmane (HashRoyale) & Zordon1337 (ZrdRoyale)");
            Resources.Initialize();
           
            WebhookUtils.SendNotify(Resources.Configuration.Srv_Webhook, Resources.LangConfiguration.SrvStarting, "Server Log");
            Logger.Log("Server started successfully. Running...", null);

            var shutdownEvent = new ManualResetEvent(false);
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                shutdownEvent.Set();
            };

            shutdownEvent.WaitOne();
            Shutdown();
            WebhookUtils.SendError(Resources.Configuration.Srv_Webhook, Resources.LangConfiguration.SrvClosing, "Server Log");
        }

        public static async void Shutdown()
        {
            
            Console.WriteLine("Shutting down...");

            await Resources.Netty.Shutdown();

            try
            {
                Console.WriteLine("Saving players...");

                lock (Resources.Players.SyncObject)
                {
                    foreach (var player in Resources.Players.Values) player.Save();
                }

                Console.WriteLine("All players saved.");
            }
            catch (Exception)
            {
                Console.WriteLine("Couldn't save all players.");
            }

            await Resources.Netty.ShutdownWorkers();
        }

        public static void Exit()
        {
            Environment.Exit(0);
        }
    }
}
