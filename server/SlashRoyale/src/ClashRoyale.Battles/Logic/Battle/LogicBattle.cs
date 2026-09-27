using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Timers;
using ClashRoyale.Battles.Core.Network.Cluster.Protocol.Messages.Client;
using ClashRoyale.Battles.Protocol.Messages.Server;
using ClashRoyale.Utilities.Models.Battle.Replay;
using Newtonsoft.Json;
using SharpRaven.Data;

namespace ClashRoyale.Battles.Logic.Battle
{
    public class LogicBattle
    {
        public LogicBattle(Session.Session session)
        {
            Session = session;

            BattleTimer = new Timer(500);
            BattleTimer.Elapsed += Tick;
        }

        public int BattleTime => (int) DateTime.UtcNow.Subtract(StartTime).TotalSeconds * 2;
        public int BattleSeconds => BattleTime / 2;

        public bool IsReady => Session.Count >= 1;

        public void Start()
        {
            if (!IsReady) return;

            foreach (var session in Session) Commands.Add(session.EndPoint, new Queue<byte[]>());

            StartTime = DateTime.UtcNow;
            BattleTimer.Start();
        }

        public void Stop()
        {
            BattleTimer.Stop();
            Resources.Sessions.Remove(Session.Id);
        }

        public async void Tick(object sender, ElapsedEventArgs args)
        {
            try
            {
                var battleEnded = true;

                foreach (var ctx in Session.ToArray())
                {
                    if (!ctx.Active) continue;

                    if (DateTime.UtcNow.Subtract(ctx.LastCommands).TotalSeconds > 3)
                    {
                        if (BattleSeconds <= 10) continue;

                        // this player has stopped fighting; wait for the others too
                    }
                    else
                    {
                        battleEnded = false;

                        await new SectorHearbeatMessage(ctx)
                        {
                            Turn = BattleTime,
                            Commands = GetOwnQueue(ctx.EndPoint)
                        }.SendAsync();
                    }
                }

                // Only resolve the battle once every player has stopped commanding.
                // The battle result (win/loss) is not knowable from the protocol, so
                // the main server treats every player as a winner; this message only
                // triggers the result handling on the main server for this session.
                if (battleEnded && BattleSeconds > 10)
                {
                    Replay.EndTick = BattleTime;

                    // Any active player works: the result is not knowable from the
                    // protocol and the main server treats every player as a winner.
                    // This message only triggers the result handling on the main server.
                    var player = Session.FirstOrDefault(ctx => ctx?.Active == true);

                    if (player != null)
                    {
                        await new BattleFinishedMessage
                        {
                            SessionId = Session.Id,
                            Index = player.Index,
                            ReplayJson = JsonConvert.SerializeObject(Replay)
                        }.SendAsync();
                    }

                    Session.Clear();
                    Stop();

                    return;
                }

                if (Session.FindIndex(s => s.BattleActive) <= -1)
                    Stop();
            }
            catch (Exception)
            {
                Logger.Log("BattleTick failed.", GetType(), ErrorLevel.Error);
            }
        }

        public Queue<byte[]> GetEnemyQueue(EndPoint endpoint)
        {
            return Commands.FirstOrDefault(cmd => cmd.Key != endpoint).Value;
        }

        public Queue<byte[]> GetOwnQueue(EndPoint endpoint)
        {
            return Commands.FirstOrDefault(cmd => cmd.Key == endpoint).Value;
        }

        #region Objects 

        private DateTime StartTime { get; set; }
        public Timer BattleTimer;
        public Dictionary<EndPoint, Queue<byte[]>> Commands = new Dictionary<EndPoint, Queue<byte[]>>();
        public Session.Session Session { get; set; }
        public LogicReplay Replay = new LogicReplay();

        #endregion
    }
}