/**
 * Serveur Universel de Bots IA Omnicanal (WhatsApp, Telegram, Messenger, Instagram, Web)
 * Moteur DeepSeek + Multi-Tenant (YE Education & Boutiques Commerçants)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AiBrain } from './core/ai-brain.js';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter.js';
import { TelegramAdapter } from './adapters/telegram.adapter.js';
import { MetaAdapter } from './adapters/meta.adapter.js';

import { yeEducationConfig } from './configs/ye-education.config.js';
import { boutiqueModeConfig } from './configs/boutique-mode.config.js';
import { PayMooneyService } from './core/paymooney.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chargement automatique des variables .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...vals] = trimmed.split('=');
        const val = vals.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    }
  }
} catch (e) {}

const PORT = process.env.PORT || 3000;

// Initialisation des Adaptateurs
const whatsappAdapter = new WhatsAppAdapter();
const telegramAdapter = new TelegramAdapter();
const metaAdapter = new MetaAdapter();

// Initialisation des Cerveaux IA
const yeBrain = new AiBrain(yeEducationConfig);
const boutiqueBrain = new AiBrain(boutiqueModeConfig);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Headers CORS universels
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 1. PAGE D'ACCUEIL & SIMULATEUR VISUEL (GET /)
  if (url.pathname === '/' && req.method === 'GET') {
    try {
      const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('🤖 Serveur de Bots IA Omnicanal Actif sur le port ' + PORT);
    }
    return;
  }

  // 1.A. LOGO & FAVICON
  if ((url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') && req.method === 'GET') {
    try {
      const svgPath = path.join(__dirname, '..', 'public', 'favicon.svg');
      const svg = fs.readFileSync(svgPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(svg);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // 1.B. TABLEAU DE BORD PRIVÉ DU COMMERÇANT (GET /dashboard)
  if ((url.pathname === '/dashboard' || url.pathname === '/dashboard.html') && req.method === 'GET') {
    try {
      const htmlPath = path.join(__dirname, '..', 'public', 'dashboard.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('Dashboard non disponible');
    }
    return;
  }

  // 1.C. DÉTAILS D'UNE BOUTIQUE (GET /api/merchants/details)
  if (url.pathname === '/api/merchants/details' && req.method === 'GET') {
    const shopSlug = url.searchParams.get('shop') || 'boutique_mode';
    const config = yeBrain.getMerchantConfig(shopSlug);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, merchant: config }));
    return;
  }

  // 1.E. TÉLÉCHARGEMENT DE FICHIERS (DOCUMENTS PDF / PHOTOS) (POST /api/upload)
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const fileName = (body.fileName || `doc_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const base64Data = body.fileBase64 ? body.fileBase64.replace(/^data:.*,/, '') : '';

      const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      const host = req.headers.host || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const fileUrl = `${protocol}://${host}/uploads/${fileName}`;

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, fileName, fileUrl }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 1.F. SERVICE DES FICHIERS ENVOYÉS (GET /uploads/*)
  if (url.pathname.startsWith('/uploads/') && req.method === 'GET') {
    try {
      const safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(__dirname, '..', 'public', safePath);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.pdf': 'application/pdf',
          '.txt': 'text/plain; charset=utf-8'
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch (e) {}
    res.writeHead(404);
    res.end('Fichier non trouvé');
    return;
  }

  // 2. VÉRIFICATION DES WEBHOOKS META (WhatsApp / Instagram / Messenger)
  if (req.method === 'GET' && (url.pathname.startsWith('/webhook/'))) {
    const verification = whatsappAdapter.handleVerification(url.searchParams);
    if (verification.success) {
      console.log(`[Meta Webhook] Vérification réussie pour ${url.pathname}`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(verification.challenge);
    } else {
      res.writeHead(403);
      res.end('Verification token mismatch');
    }
    return;
  }

  // 3. WEBHOOK WHATSAPP CLOUD API / BSP (POST /webhook/whatsapp)
  if (req.method === 'POST' && url.pathname === '/webhook/whatsapp') {
    const body = await parseJsonBody(req);
    const parsed = whatsappAdapter.parseIncomingWebhook(body);

    if (parsed && parsed.text) {
      console.log(`[WhatsApp In] De ${parsed.from} (${parsed.userName}) : "${parsed.text}"`);

      // Traitement IA via DeepSeek avec le nom de l'utilisateur
      const reply = await yeBrain.processMessage(`whatsapp:${parsed.from}`, parsed.text, 'whatsapp', { userName: parsed.userName });
      if (reply) {
        console.log(`[WhatsApp Out] Réponse générée : "${reply}"`);
        await whatsappAdapter.sendMessage(parsed.from, reply);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received' }));
    return;
  }

  // 4. WEBHOOK TELEGRAM BOT (POST /webhook/telegram)
  if (req.method === 'POST' && url.pathname === '/webhook/telegram') {
    const body = await parseJsonBody(req);
    const parsed = telegramAdapter.parseIncomingWebhook(body);

    if (parsed && parsed.text) {
      console.log(`[Telegram In] De ${parsed.chatId} (${parsed.fromName}) : "${parsed.text}"`);

      const reply = await yeBrain.processMessage(`telegram:${parsed.chatId}`, parsed.text, 'telegram', { userName: parsed.fromName });
      if (reply) {
        console.log(`[Telegram Out] Réponse générée : "${reply}"`);
        await telegramAdapter.sendMessage(parsed.chatId, reply);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received' }));
    return;
  }

  // 5. WEBHOOK MESSENGER & INSTAGRAM (POST /webhook/messenger ou /webhook/instagram)
  if (req.method === 'POST' && (url.pathname === '/webhook/messenger' || url.pathname === '/webhook/instagram')) {
    const body = await parseJsonBody(req);
    const parsed = metaAdapter.parseIncomingWebhook(body);
    const platform = url.pathname.replace('/webhook/', '');

    if (parsed && parsed.text) {
      console.log(`[${platform.toUpperCase()} In] De ${parsed.senderId} : "${parsed.text}"`);

      const reply = await yeBrain.processMessage(`${platform}:${parsed.senderId}`, parsed.text, platform);
      if (reply) {
        console.log(`[${platform.toUpperCase()} Out] Réponse générée : "${reply}"`);
        await metaAdapter.sendMessage(parsed.senderId, reply);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received' }));
    return;
  }

  // 6. API DIRECTE (SIMULATEUR & TESTS WEB) (POST /api/chat)
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await parseJsonBody(req);
    const userMessage = body.message || 'Bonjour';
    const userId = body.userId || 'test_user';
    const botType = body.botType || 'ye'; // 'ye', 'boutique', 'custom'
    const platform = body.platform || 'web';

    let brain = yeBrain;
    let overrides = {};

    if (botType === 'boutique') {
      brain = boutiqueBrain;
    } else if (botType === 'custom' && body.customConfig) {
      const customCfg = body.customConfig;
      brain = new AiBrain({
        brandName: customCfg.businessName || 'Ma Boutique',
        city: customCfg.city || 'Yaoundé',
        deliveryFees: customCfg.deliveryFees || 'Selon localisation',
        systemPrompt: `Tu es le conseiller commercial chaleureux et efficace de ${customCfg.businessName || 'notre entreprise'}.\nVoici nos offres et informations :\n${customCfg.customKnowledge || ''}`
      });
      if (customCfg.apiKey) {
        overrides.apiKey = customCfg.apiKey;
      }
    }

    const reply = await brain.processMessage(`${platform}:${userId}`, userMessage, platform, overrides);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, reply, platform, botType }));
    return;
  }

  // 7. INSCRIPTION AUTONOME DU COMMERÇANT (POST /api/merchants/register)
  if (req.method === 'POST' && url.pathname === '/api/merchants/register') {
    const body = await parseJsonBody(req);
    const businessName = body.businessName || 'Ma Boutique';
    const managerPhone = body.managerPhone || '';
    const city = body.city || 'Yaoundé';
    const deliveryTerms = body.deliveryTerms || 'Livraison disponible';
    const catalog = body.catalog || [];
    const customPrompt = body.customPrompt || '';

    // Génération automatique du slug unique (ex: "kfashion_douala")
    const rawSlug = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 25);
    const slug = `${rawSlug}_${Math.floor(100 + Math.random() * 900)}`;

    const merchantData = {
      businessName,
      managerPhone,
      city,
      deliveryTerms,
      catalog,
      systemPrompt: customPrompt || `Tu es le conseiller commercial dynamique de "${businessName}" à ${city}. Présente les articles, informe sur la livraison (${deliveryTerms}) et prends les commandes.`,
      credits_remaining: 20,
      total_messages_processed: 0
    };

    // Enregistrement en mémoire instantanée
    yeBrain.registerMerchant(slug, merchantData);

    // Enregistrement asynchrone dans Supabase si configuré
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        fetch(`${process.env.SUPABASE_URL}/rest/v1/merchants`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            business_name: businessName,
            manager_phone: managerPhone,
            city: city,
            delivery_terms: deliveryTerms,
            catalog: catalog,
            system_prompt: merchantData.systemPrompt,
            credits_remaining: 20
          })
        }).catch(err => console.warn('[Supabase Insert Error]:', err.message));
      } catch (e) {}
    }

    const host = req.headers.host || 'plateforme-bots-multicanal-production.up.railway.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      slug: slug,
      businessName: businessName,
      links: {
        telegram: `https://t.me/Alnafisnolan_bot?start=${slug}`,
        webChat: `${protocol}://${host}/?shop=${slug}`,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://t.me/Alnafisnolan_bot?start=${slug}`
      },
      message: "Boutique configurée avec succès ! Vos 20 messages d'essai sont activés."
    }));
    return;
  }

  // 8. CRÉATION DE PAIEMENT PAYMOONEY (POST /api/paymooney/create-payment)
  if (req.method === 'POST' && url.pathname === '/api/paymooney/create-payment') {
    const body = await parseJsonBody(req);
    const packId = body.packId || 'pack_500';
    const merchantInfo = body.merchantInfo || {};
    const returnUrl = body.returnUrl || `http://${req.headers.host}`;

    const paymooney = new PayMooneyService();
    const result = await paymooney.createPaymentUrl(packId, merchantInfo, returnUrl);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // 9. WEBHOOK DE CONFIRMATION PAYMOONEY (POST /webhook/paymooney)
  if (req.method === 'POST' && url.pathname === '/webhook/paymooney') {
    const body = await parseJsonBody(req);
    console.log('[PayMooney Webhook Reçu] :', body);

    if (body && (body.status === 'success' || body.response === 'success' || body.payment_status === 'COMPLETED')) {
      const itemRef = body.item_ref || body.ref_payment;
      console.log(`[PayMooney] Paiement confirmé pour la référence : ${itemRef}`);
      yeBrain.addCredits(500);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Notification traitée' }));
    return;
  }

  // 10. SANTÉ DU SYSTÈME (GET /health)
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime(), timestamp: Date.now() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
  });
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 SERVEUR DE BOTS IA OMNICANAUX ACTIF (DEEPSEEK)`);
  console.log(`🌐 Accédez au simulateur sur : http://localhost:${PORT}`);
  console.log(`📱 Webhooks WhatsApp : http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`📱 Webhooks Telegram : http://localhost:${PORT}/webhook/telegram`);
  console.log(`======================================================\n`);
});
