/**
 * @lp/notifications — out-of-band notifications to humans.
 *
 * Channels: in-app, Telegram, WhatsApp, Email. Each channel implements the
 * same Channel interface so the dispatcher can route a single message to
 * multiple channels per the user's preferences.
 *
 * Today: interface + stubs that just console.log. When Hermes' messaging
 * gateways are wired in (Hermes already supports Telegram + WhatsApp + Discord
 * + Slack natively), we'll point the Telegram + WhatsApp channels at Hermes'
 * RPC instead of building our own bots.
 */

export type ChannelId = "in_app" | "telegram" | "whatsapp" | "email";

export type EventKind =
  | "beat.needs_review"
  | "beat.author_failed"
  | "beat.render_failed"
  | "lesson.stitched"
  | "lesson.published"
  | "hermes.style_suggested"
  | "hermes.evolution_complete";

export interface NotificationPayload {
  kind: EventKind;
  /** Plain-text body for the notification. */
  body: string;
  /** Deep link back into the app. */
  url?: string;
  /** Free-form context for the notification template. */
  data?: Record<string, unknown>;
}

export interface ChannelConfig {
  telegram?: { botToken: string; chatId: string };
  whatsapp?: { hermesRpcUrl: string; phoneNumber: string };
  email?: { fromAddress: string; smtpUrl: string; toAddress: string };
  hermes?: { rpcUrl: string };
}

export interface NotificationChannel {
  id: ChannelId;
  send(payload: NotificationPayload): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

export interface NotificationClient {
  dispatch(channels: ChannelId[], payload: NotificationPayload): Promise<Array<{ channel: ChannelId; ok: boolean; messageId?: string; error?: string }>>;
}

export function createNotificationClient(config: ChannelConfig): NotificationClient {
  const channels: Partial<Record<ChannelId, NotificationChannel>> = {
    in_app: makeInAppChannel(),
  };
  if (config.telegram) channels.telegram = makeTelegramStub(config.telegram);
  if (config.whatsapp) channels.whatsapp = makeWhatsappStub(config.whatsapp);
  if (config.email)    channels.email    = makeEmailStub(config.email);

  return {
    async dispatch(targets, payload) {
      const out: Array<{ channel: ChannelId; ok: boolean; messageId?: string; error?: string }> = [];
      for (const id of targets) {
        const ch = channels[id];
        if (!ch) {
          out.push({ channel: id, ok: false, error: `channel not configured: ${id}` });
          continue;
        }
        const res = await ch.send(payload);
        out.push({ channel: id, ...res });
      }
      return out;
    },
  };
}

function makeInAppChannel(): NotificationChannel {
  return {
    id: "in_app",
    async send(payload) {
      // Real impl: write to a Postgres in_app_notifications table so the UI
      // can show a bell badge. Today: noop.
      console.log("[notifications][in_app]", payload.kind, "—", payload.body);
      return { ok: true, messageId: `inapp-${Date.now()}` };
    },
  };
}

function makeTelegramStub(_config: { botToken: string; chatId: string }): NotificationChannel {
  return {
    id: "telegram",
    async send(payload) {
      // Real impl: POST https://api.telegram.org/bot<token>/sendMessage
      console.log("[notifications][telegram]", payload.kind, "—", payload.body);
      return { ok: true, messageId: `tg-stub-${Date.now()}` };
    },
  };
}

function makeWhatsappStub(_config: { hermesRpcUrl: string; phoneNumber: string }): NotificationChannel {
  return {
    id: "whatsapp",
    async send(payload) {
      // Real impl: RPC call to Hermes' WhatsApp gateway.
      console.log("[notifications][whatsapp]", payload.kind, "—", payload.body);
      return { ok: true, messageId: `wa-stub-${Date.now()}` };
    },
  };
}

function makeEmailStub(_config: { fromAddress: string; smtpUrl: string; toAddress: string }): NotificationChannel {
  return {
    id: "email",
    async send(payload) {
      // Real impl: nodemailer or Resend.
      console.log("[notifications][email]", payload.kind, "—", payload.body);
      return { ok: true, messageId: `email-stub-${Date.now()}` };
    },
  };
}
