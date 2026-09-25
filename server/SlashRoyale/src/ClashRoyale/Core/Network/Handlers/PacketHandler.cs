using System;
using System.Net;
using ClashRoyale.Extensions.Utils;
using ClashRoyale.Logic;
using ClashRoyale.Logic.Home;
using DotNetty.Buffers;
using DotNetty.Handlers.Timeout;
using DotNetty.Transport.Channels;
using SharpRaven.Data;

namespace ClashRoyale.Core.Network.Handlers
{
    public class PacketHandler : ChannelHandlerAdapter
    {
        public PacketHandler()
        {
            Throttler = new Throttler(10, 500);
            Device = new Device(this);
        }

        public Device Device { get; set; }
        public IChannel Channel { get; set; }
        public Throttler Throttler { get; set; }

        public override void ChannelRead(IChannelHandlerContext context, object message)
        {
            var buffer = (IByteBuffer)message;
            if (buffer == null) return;

            if (Throttler.CanProcess())
            {
                Device.Process(buffer);
            }
            else
            {
                Logger.Log("Client reached ratelimit. Disconnecting...", GetType(), ErrorLevel.Warning);
                Device.Disconnect();
            }
        }

        public override void ChannelReadComplete(IChannelHandlerContext context)
        {
            context.Flush();
        }

        public override void ChannelRegistered(IChannelHandlerContext context)
        {
            Channel = context.Channel;

            var remoteAddress = (IPEndPoint)Channel.RemoteAddress;

            Logger.Log($"Client {remoteAddress.Address.MapToIPv4()}:{remoteAddress.Port} connected.", GetType(),
                ErrorLevel.Debug);

            base.ChannelRegistered(context);
        }

        public override async void ChannelUnregistered(IChannelHandlerContext context)
        {
            try
            {
                var player = await Resources.Players.GetPlayerAsync(Device.Player.Home.Id, true);
                if (Device?.Player?.Home != null)
                {

                    if (player != null)
                        if (player.Device.Session.SessionId == Device.Session.SessionId)
                        {
                            Resources.Players.LogoutById(player.Home.Id);

                            if (player.Home.AllianceInfo.HasAlliance)
                            {
                                var alliance = await Resources.Alliances.GetAllianceAsync(player.Home.AllianceInfo.Id);
                                if (alliance != null)
                                {
                                    var entry = alliance.Stream.Find(e =>
                                        e.SenderId == player.Home.Id && e.StreamEntryType == 10);
                                    if (entry != null) alliance.RemoveEntry(entry);

                                    if (alliance.Online < 1)
                                        Resources.Alliances.Remove(alliance.Id);
                                    /*Logger.Log($"Uncached Clan {alliance.Id} because no member is online.", GetType(),
                                            ErrorLevel.Debug);*/
                                    else alliance.UpdateOnlineCount();
                                }
                            }
                        }
                }

                var remoteAddress = (IPEndPoint)Channel.RemoteAddress;

                Logger.Log($"Client {remoteAddress.Address.MapToIPv4()}:{remoteAddress.Port} disconnected.", GetType(),
                    ErrorLevel.Debug);

                WebhookUtils.SendNotify(Resources.Configuration.Plr_Webhook, Resources.LangConfiguration.PlrConnLost.Replace("%PlayerName", player.Home.Name), "Player Log");

                base.ChannelUnregistered(context);
            }
            catch (Exception e)
            {
                WebhookUtils.SendError(Resources.Configuration.error_webhook, $"An Server crash has been detected\n```{e.Message}\n{e.StackTrace}```Server will continue to work", "Crash detected");
            }
        }

        public override void ExceptionCaught(IChannelHandlerContext context, Exception exception)
        {
            if (exception.GetType() != typeof(ReadTimeoutException) &&
                exception.GetType() != typeof(WriteTimeoutException))
                Logger.Log(exception, GetType(), ErrorLevel.Error);

            context.CloseAsync();
        }
    }
}