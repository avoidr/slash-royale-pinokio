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
            Console.Title = "HashRoyale";

            Console.WriteLine("\r\n    __  __              __     ____                        __    \r\n   / / / /____ _ _____ / /_   / __ \\ ____   __  __ ____ _ / /___ \r\n  / /_/ // __ `// ___// __ \\ / /_/ // __ \\ / / / // __ `// // _ \\\r\n / __  // /_/ /(__  )/ / / // _, _// /_/ // /_/ // /_/ // //  __/\r\n/_/ /_/ \\__,_//____//_/ /_//_/ |_| \\____/ \\__, / \\__,_//_/ \\___/ \r\n                                         /____/                  \r\n");
            Console.WriteLine("Fork of ZrdRoyale by Hashmane");
            Console.WriteLine("Thanks to Zordon1337 for work on orginal version of ZrdRoyale");
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
