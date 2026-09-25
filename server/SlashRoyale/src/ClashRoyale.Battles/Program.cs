using System;
using System.Threading;

namespace ClashRoyale.Battles
{
    public class Program
    {
        private static void Main(string[] args)
        {
            Console.Title = "ClashRoyale Battle Server Emulator";

            Console.WriteLine(
                "\n   ________           __    ____                    __\r\n  / ____/ /___ ______/ /_  / __ \\____  __  ______ _/ /__\r\n / /   / / __ `/ ___/ __ \\/ /_/ / __ \\/ / / / __ `/ / _ \\\r\n/ /___/ / /_/ (__  ) / / / _, _/ /_/ / /_/ / /_/ / /  __/\r\n\\____/_/\\__,_/____/_/ /_/_/ |_|\\____/\\__, /\\__,_/_/\\___/\r\n                                    /____/   Battles\n\n");

            Resources.Initialize();

            var shutdownEvent = new ManualResetEvent(false);
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                shutdownEvent.Set();
            };

            shutdownEvent.WaitOne();
        }
    }
}