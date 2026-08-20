/**
 * Service de Paiement Automatique PayMooney (Orange Money & MTN MoMo)
 * Génère les liens de paiement et gère la validation automatique des recharges
 */

export class PayMooneyService {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'https://www.paymooney.com/api/v1.0/payment_url';
    this.publicKey = options.publicKey || process.env.PAYMOONEY_PUBLIC_KEY || '';
    this.privateKey = options.privateKey || process.env.PAYMOONEY_PRIVATE_KEY || '';
    this.environment = options.environment || process.env.PAYMOONEY_ENV || 'live';
  }

  /**
   * Forfaits de recharges disponibles
   */
  static PACKS = {
    'pack_500': { id: 'pack_500', name: 'Mini-Pack (100 messages)', amount: 500, credits: 100 },
    'pack_2500': { id: 'pack_2500', name: 'Pack Semaine (600 messages)', amount: 2500, credits: 600 },
    'pack_5000': { id: 'pack_5000', name: 'Pack Mensuel Starter (1.500 messages)', amount: 5000, credits: 1500 },
    'pack_10000': { id: 'pack_10000', name: 'Pack Mensuel Pro (4.000 messages)', amount: 10000, credits: 4000 },
    'pack_25000': { id: 'pack_25000', name: 'Pack VIP Illimité', amount: 25000, credits: 20000 }
  };

  /**
   * Crée une session de paiement Mobile Money PayMooney
   * @param {string} packId - Identifiant du pack choisi (ex: 'pack_500', 'pack_5000')
   * @param {Object} merchantInfo - Informations du commerçant { id, name, phone, email }
   * @param {string} returnUrl - URL de retour après paiement
   */
  async createPaymentUrl(packId, merchantInfo = {}, returnUrl = '') {
    const pack = PayMooneyService.PACKS[packId] || PayMooneyService.PACKS['pack_5000'];
    const itemRef = `BOT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    if (!this.publicKey) {
      console.warn('[PayMooney] Clé publique manquante, simulation du lien de paiement.');
      return {
        success: true,
        paymentUrl: `https://test.paymooney.com/pay?ref=${itemRef}&amount=${pack.amount}`,
        itemRef,
        pack
      };
    }

    const payload = {
      amount: pack.amount.toString(),
      currency_code: 'XAF',
      ccode: 'CM',
      lang: 'fr',
      item_ref: itemRef,
      item_name: `Recharge Bot IA - ${pack.name}`,
      description: `Recharge de ${pack.credits} messages IA pour ${merchantInfo.name || 'Boutique'}`,
      email: merchantInfo.email || '',
      phone: merchantInfo.phone || '',
      first_name: merchantInfo.firstName || merchantInfo.name || 'Commerçant',
      last_name: merchantInfo.lastName || 'Client',
      public_key: this.publicKey,
      logo: 'https://ye-education.com/logo.png',
      environement: this.environment,
      return_url: returnUrl || 'https://ye-education.com/payment-success'
    };

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.payment_url) {
        return {
          success: true,
          paymentUrl: data.payment_url,
          itemRef: itemRef,
          pack: pack,
          raw: data
        };
      } else {
        console.error('[PayMooney] Erreur création paiement :', data);
        return { success: false, error: data.message || 'Erreur PayMooney' };
      }
    } catch (e) {
      console.error('[PayMooney] Exception :', e.message);
      return { success: false, error: e.message };
    }
  }
}
