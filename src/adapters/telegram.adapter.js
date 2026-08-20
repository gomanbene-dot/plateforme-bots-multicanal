/**
 * Adaptateur Telegram Bot API
 * Permet d'envoyer et recevoir des messages sur Telegram de manière robuste
 */

export class TelegramAdapter {
  constructor(botToken = '') {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  /**
   * Extrait le message Telegram
   */
  parseIncomingWebhook(body) {
    const message = body?.message || body?.edited_message;
    if (!message || !message.text) return null;

    return {
      messageId: `tg_${message.message_id}`,
      chatId: message.chat.id,
      fromName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Utilisateur',
      text: message.text.trim(),
      timestamp: message.date ? message.date * 1000 : Date.now()
    };
  }

  /**
   * Envoie une réponse Telegram
   */
  async sendMessage(chatId, text, customToken = null) {
    const token = customToken || process.env.TELEGRAM_BOT_TOKEN || this.botToken;
    if (!token) {
      console.log(`[Telegram Local Mode] Message prêt pour ${chatId} : "${text}"`);
      return { success: true, mode: 'simulated' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('[TelegramAdapter] Erreur API Telegram :', data);
      }
      return { success: response.ok, data };
    } catch (e) {
      console.error('[TelegramAdapter] Exception fetch :', e.message);
      return { success: false, error: e.message };
    }
  }
}
