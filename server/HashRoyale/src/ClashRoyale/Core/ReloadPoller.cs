using System.IO;
using System.Threading.Tasks;

namespace ClashRoyale.Core
{
    /// <summary>
    ///     Watches the "reloads" folder for "&lt;playerId&gt;.pol" marker files written
    ///     by the admin panel. Each marker asks Players to drop that player from
    ///     memory so the next login is loaded fresh from the database.
    /// </summary>
    public static class ReloadPoller
    {
        public static void Start()
        {
            Task.Run(async () =>
            {
                var dir = Path.Combine(Directory.GetCurrentDirectory(), "reloads");

                try
                {
                    Directory.CreateDirectory(dir);
                }
                catch
                {
                    // ignore
                }

                while (true)
                {
                    try
                    {
                        await Task.Delay(500);

                        if (!Directory.Exists(dir)) continue;

                        foreach (var file in Directory.GetFiles(dir, "*.pol"))
                        {
                            var name = Path.GetFileNameWithoutExtension(file);

                            if (long.TryParse(name, out var id))
                            {
                                Logger.Log($"Reloading player {id} (admin edit)...", typeof(ReloadPoller));
                                Resources.Players.ReloadPlayer(id);
                            }

                            try
                            {
                                File.Delete(file);
                            }
                            catch
                            {
                                // ignore
                            }
                        }
                    }
                    catch
                    {
                        // keep polling
                    }
                }
            });
        }
    }
}