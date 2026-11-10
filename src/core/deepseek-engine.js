/**
 * Moteur LLM DeepSeek officiel & intelligent avec Moteur Local Enrichi
 */

export class DeepSeekEngine {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.fallbackGeminiKey = options.fallbackGeminiKey || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Génère une réponse via DeepSeek
   */
  async generateResponse(messages, options = {}) {
    const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || this.apiKey;
    const model = options.model || this.model;

    // 1. Appel officiel à l'API DeepSeek si la clé est présente
    if (apiKey && apiKey.trim().length > 5) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: model,
            messages: messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 700,
            stream: false
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            return {
              text: content.trim(),
              provider: 'deepseek',
              model: model,
              usage: data.usage
            };
          }
        } else {
          const errorText = await response.text();
          console.warn(`[DeepSeek API] Erreur (${response.status}) : ${errorText}`);
        }
      } catch (err) {
        console.error('[DeepSeek] Erreur réseau / API :', err.message);
      }
    }

    // 2. Fallback Gemini si disponible
    const geminiKey = process.env.GEMINI_API_KEY || this.fallbackGeminiKey;
    if (geminiKey && geminiKey.trim().length > 5) {
      try {
        const geminiResponse = await this._callGeminiFallback(messages, geminiKey.trim());
        if (geminiResponse) {
          return {
            text: geminiResponse,
            provider: 'gemini-fallback',
            model: 'gemini-1.5-flash'
          };
        }
      } catch (err) {
        console.warn('[Gemini Fallback] Erreur :', err.message);
      }
    }

    throw new Error('AI_PROVIDER_UNAVAILABLE');
  }

  async _callGeminiFallback(messages, apiKey) {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userAndAssistant = messages.filter(m => m.role !== 'system');

    const contents = [
      ...(systemMessage ? [{ role: 'user', parts: [{ text: `INSTRUCTIONS DU SYSTÈME :\n${systemMessage}` }] }] : []),
      ...userAndAssistant.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
        })
      }
    );

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    }
    return null;
  }

  /**
   * Moteur local sobre capable de répondre poliment sur l'application YE
   */
}
