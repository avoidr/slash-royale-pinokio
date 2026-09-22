using System;
using System.Linq;
using ClashRoyale.Database;
using ClashRoyale.Database.Cache;
using ClashRoyale.Logic;
using ClashRoyale.Logic.Clan;
using ClashRoyale.Logic.Clan.StreamEntry.Entries;
using ClashRoyale.Logic.Home.Decks;
using ClashRoyale.Protocol.Messages.Server;
using ClashRoyale.Utilities;
using ClashRoyale.Utilities.Netty;
using DotNetty.Buffers;

namespace ClashRoyale.Protocol.Messages.Client.Alliance
{
    public class ChatToAllianceStreamMessage : PiranhaMessage
    {
        public ChatToAllianceStreamMessage(Device device, IByteBuffer buffer) : base(device, buffer)
        {
            Id = 14315;
        }

        public string Message { get; set; }

        public override void Decode()
        {
            Message = Reader.ReadScString();
        }

        public void SendMessage(string message, Logic.Clan.Alliance alliance)
        {
            var entry = new ChatStreamEntry
            {
                Message = message
            };

            entry.SetSender(Device.Player);

            alliance.AddEntry(entry);
        }

        public override async void Process()
        {
            var info = Device.Player.Home.AllianceInfo;
            if (!info.HasAlliance) return;

            var alliance = await Resources.Alliances.GetAllianceAsync(info.Id);
            if (alliance == null) return;

            if (Message.StartsWith('/'))
            {
                var cmd = Message.Split(' ');
                var cmdType = cmd[0];
                var cmdValue = 0;

                if (cmd.Length > 1)
                    if (Message.Split(' ')[1].Any(char.IsDigit))
                        int.TryParse(Message.Split(' ')[1], out cmdValue);

                switch (cmdType)
                {
                    case "/max":
                    {
                        

                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                var deck = Device.Player.Home.Deck;

                                foreach (var card in Cards.GetAllCards())
                                {
                                    deck.Add(card);

                                    for (var i = 0; i < 12; i++) deck.UpgradeCard(card.ClassId, card.InstanceId, true);
                                }

                                await new ServerErrorMessage(Device)
                                {
                                    Message = "Added all cards with max level"
                                }.SendAsync();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;
                    }

                    case "/unmax":
                    {
                        if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                        {
                            var deck = Device.Player.Home.Deck;

                            foreach (var card in deck) card.Level = 0;

                            await new ServerErrorMessage(Device)
                            {
                                Message = "All cards reset to level 1"
                            }.SendAsync();
                        }
                        else
                        {
                            var entry = new ChatStreamEntry
                            {
                                Message =
                                "only admins can use / commands."
                            };

                            entry.SetSender(Device.Player);

                            alliance.AddEntry(entry);
                        }
                        break;
                    }

                    case "/unlock":
                    {


                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                var deck = Device.Player.Home.Deck;

                                foreach (var card in Cards.GetAllCards()) deck.Add(card);

                                await new ServerErrorMessage(Device)
                                {
                                    Message = "Added all cards"
                                }.SendAsync();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;
                    }

                    case "/gold":
                    {
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                Device.Player.Home.Gold += cmdValue;
                                Device.Disconnect();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;
                        }
                    case "/gems":
                    {
                            
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                Device.Player.Home.Diamonds += cmdValue;
                                Device.Disconnect();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;    
                    }

                    case "/status":
                    {
                            
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    $"Server status:\nBuild version: 1.5 (for 1.9.2)\nFingerprint SHA:\n{Resources.Fingerprint.Sha}\nOnline Players: {Resources.Players.Count}\nTotal Players: {await PlayerDb.CountAsync()}\n1v1 Battles: {Resources.Battles.Count}\n2v2 Battles: {Resources.DuoBattles.Count}\nTotal Clans: {await AllianceDb.CountAsync()}\nUptime: {DateTime.UtcNow.Subtract(Resources.StartTime).ToReadableString()}\nUsed RAM: {System.Diagnostics.Process.GetCurrentProcess().WorkingSet64 / (1024 * 1024) + " MB"}"
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;    
                    }

                    case "/help":
                    {
                            
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    $"List of commands:\n/max - open all cards max\n/unmax - reset all cards back to level 1\n/unlock - open all cards\n/gold x - give out gold, where x - amount of gold\n/gems x - give out gems, where x - amount of gems\n/status - a command that shows the server status (needed for admins)\n/free - resets the timer of the free chest\n/trophies x - adds trophies, where x - the number of trophies (can be negative)\n/set x - the specified number of trophies is available, where x - the number of trophies\n/ban x - bans the user, where x - the user ID\n/admin x - makes the user an admin, where x - the user ID\n/level x - sets the level of the player, where x - level"
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break;    
                    }

                    case "/ban":
                        if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                        {
                            var player = await PlayerDb.GetAsync(cmdValue);

                            if (player == null)
                            {
                                SendMessage($"player with ID {cmdValue} was not found.", alliance);
                                break;
                            }

                            Resources.Configuration.BannedIds.Add(player.Home.Id);
                            Resources.Configuration.Save();
                            Resources.Configuration.Initialize();
                            SendMessage($"The player with ID {cmdValue} has been banned.", alliance);
                            Logger.Log($"The player with ID {cmdValue} has been banned.", GetType());
                        }
                        else SendMessage("only admins can use / commands.", alliance);
                        break;

                    case "/admin":
                        if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                        {
                            var player = await PlayerDb.GetAsync(cmdValue);

                            if (player == null)
                            {
                                SendMessage($"player with ID {cmdValue} was not found.", alliance);
                                break;
                            }

                            Resources.Configuration.Admins.Add(player.Home.Id);
                            Resources.Configuration.Save();
                            Resources.Configuration.Initialize();
                            SendMessage($"player with ID {cmdValue} is now an admin.", alliance);
                            Logger.Log($"player with ID {cmdValue} is now an admin.", GetType());
                        }
                        else SendMessage("only admins can use / commands.", alliance);
                        break;

                    case "/level":
                        if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                        {
                            Device.Player.Home.ExpLevel = cmdValue;
                            Device.Disconnect();
                        }
                        else SendMessage("only admins can use / commands.", alliance);
                        break;

                    case "/set":
                    {
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                Device.Player.Home.Arena.SetTrophies(cmdValue);
                                Device.Disconnect();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break; 
                    }

                    case "/free":
                    {
                            if (ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                Device.Player.Home.FreeChestTime = Device.Player.Home.FreeChestTime.Subtract(TimeSpan.FromMinutes(245));
                                Device.Disconnect();
                            }
                            else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            break; 
                    }

                        /*case "/replay":
                        {
                            await new HomeBattleReplayDataMessage(Device).SendAsync();
                            break;
                        }*/

                        case "/trophies":
                        {
                            if(ClashRoyale.Extensions.Utils.AdminUtils.CheckIfAdmin((int)Device.Player.Home.Id))
                            {
                                if (cmdValue >= 0)
                                    Device.Player.Home.Arena.AddTrophies(cmdValue);
                                else if (cmdValue < 0)
                                    Device.Player.Home.Arena.RemoveTrophies(cmdValue);
                                Device.Disconnect();
                            } else
                            {
                                var entry = new ChatStreamEntry
                                {
                                    Message =
                                    "only admins can use / commands."
                                };

                                entry.SetSender(Device.Player);

                                alliance.AddEntry(entry);
                            }
                            

                            
                            break;
                        }
                    default:
                        var error = new ChatStreamEntry
                        {
                            Message =
                             $"Command not found. Use /help for the list of commands."
                        };

                        error.SetSender(Device.Player);

                        alliance.AddEntry(error);
                        break;
                }
            }
            else
            {
                var entry = new ChatStreamEntry
                {
                    Message = Message
                };

                entry.SetSender(Device.Player);

                alliance.AddEntry(entry);
            }
        }
    }
}
