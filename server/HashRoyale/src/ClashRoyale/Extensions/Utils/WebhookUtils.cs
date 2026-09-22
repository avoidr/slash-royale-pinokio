using Discord.Webhook;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;

namespace ClashRoyale.Extensions.Utils
{
    
    public class WebhookUtils
    {
        public static void SendError(string URL, string message,string title)
        {

            var webhookObject = new WebhookObject();
            webhookObject.AddEmbed(builder =>
            {
                builder.WithTitle(title)
                    .WithDescription(message)
                    .WithColor(Colors.Red);
            });
            Webhook.SendAsync(URL, webhookObject, "LogError");
            
        }
        public static void SendNotify(string URL, string message, string title)
        {

            var webhookObject = new WebhookObject();
            webhookObject.AddEmbed(builder =>
            {
                builder.WithTitle(title)
                    .WithDescription(message)
                    .WithColor(Colors.Green);
            });
            Webhook.SendAsync(URL, webhookObject, "LogNotify");

        }
    }
}
