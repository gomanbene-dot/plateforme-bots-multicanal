/**
 * Serveur Universel de Bots IA Omnicanal (WhatsApp, Telegram, Messenger, Instagram, Web)
 * Moteur DeepSeek + Multi-Tenant (YE Education & Boutiques Commerçants)
 */

import http from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { TenantRegistry } from './core/tenant-registry.js';
import { Analytics } from './core/analytics.js';
import { Inbox } from './core/inbox.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AiBrain } from './core/ai-brain.js';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter.js';
import { TelegramAdapter } from './adapters/telegram.adapter.js';
import { MetaAdapter } from './adapters/meta.adapter.js';
import { WhatsAppBaileysAdapter } from './adapters/whatsapp-baileys.adapter.js';

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
const registry=new TenantRegistry();
yeBrain.analytics=new Analytics(registry.dir);
yeBrain.inbox=new Inbox(registry.dir);

/**
 * Envoie la réponse d'un membre de l'équipe sur le réseau d'origine de la conversation.
 * Les jetons d'accès ne sont jamais stockés dans la conversation : ils sont relus
 * depuis la configuration du canal au moment de l'envoi.
 */
async function deliverAgentMessage(slug, conv, text){
  const d=conv.delivery||{};
  const ok=r=>r===true||!!r?.success;
  if(d.via==='web'){yeBrain.inbox.queueWeb(slug,conv.id,text);return {success:true};}
  if(d.via==='baileys'){
    if(slug!==yeEducationConfig.id)return {success:false,error:'Ce numéro WhatsApp n’appartient pas à cette entreprise'};
    return {success:ok(await whatsappBaileys.sendMessage(d.to,text)),error:'WhatsApp non connecté'};
  }
  if(d.via==='telegram')return {success:ok(await telegramAdapter.sendMessage(d.to,text)),error:'Envoi Telegram impossible'};
  if(d.via==='cloud'||d.via==='meta'){
    const ch=channelFor(conv.platform,d.channelId);
    if(!ch||ch.merchantSlug!==slug)return {success:false,error:'Canal non connecté à cette entreprise'};
    const r=d.via==='cloud'
      ?await whatsappAdapter.sendMessage(d.to,text,process.env[ch.tokenEnv],d.channelId)
      :await metaAdapter.sendMessage(d.to,text,process.env[ch.tokenEnv],ch);
    return {success:ok(r),error:'Le réseau a refusé l’envoi'};
  }
  return {success:false,error:'Canal de réponse inconnu pour cette conversation'};
}
const routesFile=path.join(registry.dir,'channels.json');
const channelRoutes=fs.existsSync(routesFile)?JSON.parse(fs.readFileSync(routesFile,'utf8')):{};
function channelFor(platform,id){
 const row=channelRoutes[platform+':'+id];
 if(!row || !yeBrain.getMerchantConfig(row.merchantSlug) || !process.env[row.tokenEnv])return null;
 return row;
}
for(const [slug,row] of Object.entries(registry.data))yeBrain.registerMerchant(slug,row.config);

// Adaptateur WhatsApp Web QR Code (Baileys)
const whatsappBaileys = new WhatsAppBaileysAdapter({
  sessionId: 'ye_principal',
  onMessage: async ({ senderKey, senderPhone, pushName, text, remoteJid }) => {
    return await yeBrain.processMessage(senderKey, text, 'whatsapp', { userName: pushName, delivery: { via: 'baileys', to: remoteJid || senderPhone } });
  }
});
// Démarrage automatique en arrière-plan
if(process.env.ENABLE_WHATSAPP_WEB === 'true') whatsappBaileys.start().catch(err => console.error('[Baileys Startup]', err));

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const actor=registry.authenticate((req.headers.authorization||'').replace(/^Bearer /,''));
  if(url.pathname.startsWith('/api/') && req.method!=='OPTIONS'){
    if(!actor){res.writeHead(401);res.end('Connexion requise');return;}
    if(req.method==='POST')req.parsedBody=await parseJsonBody(req);
    if(!actor.admin && ['/api/merchants/register','/api/upload','/api/paymooney/create-payment'].includes(url.pathname)){res.writeHead(403);res.end();return;}
    if(!actor.admin && url.pathname.startsWith('/api/whatsapp')){res.writeHead(403);res.end();return;}
    const shop=url.searchParams.get('shop')||req.parsedBody?.shop||actor.slug;
    if(!actor.admin && shop!==actor.slug){res.writeHead(403);res.end();return;}
    url.searchParams.set('shop',shop);
    if(req.parsedBody)req.parsedBody.shop=shop;
  }
  if(req.method==='POST' && url.pathname.startsWith('/webhook/')){
    if(url.pathname==='/webhook/paymooney'){res.writeHead(503);res.end('Validation paiement indisponible');return;}
    req.parsedBody=await parseJsonBody(req);
    if(url.pathname==='/webhook/telegram'){
      if(!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token']!==process.env.TELEGRAM_WEBHOOK_SECRET){res.writeHead(403);res.end();return;}
    }else{
      if(!process.env.META_APP_SECRET){res.writeHead(503);res.end('Configuration Meta manquante');return;}
      const expected='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(req.rawBody).digest('hex');
      const received=req.headers['x-hub-signature-256'];
      if(typeof received!=='string'||received.length!==expected.length||!timingSafeEqual(Buffer.from(received),Buffer.from(expected))){res.writeHead(403);res.end();return;}
    }
  }
  if(url.pathname==='/connexion'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname,'../public/connexion.html')));return;
  }
  if(url.pathname==='/api/merchants/profile' && req.method==='POST'){
    const body=req.parsedBody,config=yeBrain.getMerchantConfig(body.shop);
    if(!config){res.writeHead(404);res.end('Entreprise inconnue');return;}
    if(body.logoUrl && !/^https:\/\//.test(body.logoUrl)){res.writeHead(400);res.end('Le logo doit utiliser HTTPS');return;}
    for(const key of ['businessName','botName','supportEmail','logoUrl','customDocs']){
      if(typeof body[key]==='string')config[key]=body[key].slice(0,key==='customDocs'?12000:2048);
    }
    if(body.shop!=='ye_almanach')config.systemPrompt='Tu es '+config.botName+', assistant virtuel de '+config.businessName+'. Réponds uniquement avec les informations de cette entreprise et propose son contact si elles manquent.';
    registry.sync(yeBrain.merchantCache);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}));return;
  }
  // Headers CORS universels
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
    if(!config){res.writeHead(404);res.end('{}');return;}
    const { apiKey, recentConversations, ...safeConfig }=config;
    res.end(JSON.stringify({ success: true, merchant: safeConfig }));
    return;
  }

  // 1.C.2 RÉGLAGES DE STYLE, ÉMOJIS ET REGISTRE (GET & POST /api/settings/style)
  if (url.pathname === '/api/settings/style' && req.method === 'GET') {
    const shopSlug = url.searchParams.get('shop') || 'ye_almanach';
    const config = (shopSlug === 'ye_almanach') ? yeEducationConfig : yeBrain.getMerchantConfig(shopSlug);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, styleSettings: config?.styleSettings || {} }));
    return;
  }

  if (url.pathname === '/api/settings/style' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const shopSlug = body.shop || 'ye_almanach';
    const newStyle = {
      emojiLevel: body.emojiLevel || 'none',
      register: body.register || 'professionnel_courtois',
      customDirectives: body.customDirectives || ''
    };

    if (shopSlug === 'ye_almanach') {
      yeEducationConfig.styleSettings = newStyle;
    }
    const merchant = yeBrain.getMerchantConfig(shopSlug);
    if (merchant) {
      merchant.styleSettings = newStyle;
    }

    registry.sync(yeBrain.merchantCache);
    console.log(`[Style Update] Nouveau style configuré pour ${shopSlug} : Emojis=${newStyle.emojiLevel}, Registre=${newStyle.register}`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Style mis à jour avec succès', styleSettings: newStyle }));
    return;
  }

  // 1.D. ROUTES WHATSAPP WEB QR CODE (Statut, QR, Déconnexion)
  if (url.pathname === '/api/whatsapp/status' && req.method === 'GET') {
    const status = whatsappBaileys.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, ...status }));
    return;
  }

  if (url.pathname === '/api/whatsapp/qr' && req.method === 'GET') {
    const status = whatsappBaileys.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, qrCode: status.qrCode, status: status.status }));
    return;
  }

  if (url.pathname === '/api/whatsapp/disconnect' && req.method === 'POST') {
    await whatsappBaileys.disconnect();
    setTimeout(() => whatsappBaileys.start(), 1500);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Session WhatsApp réinitialisée' }));
    return;
  }

  if (url.pathname === '/api/whatsapp/restart' && req.method === 'POST') {
    await whatsappBaileys.start();
    const status = whatsappBaileys.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, ...status }));
    return;
  }

  if (url.pathname === '/api/whatsapp/send' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const userStatus = whatsappBaileys.getStatus();
    const to = body.to || (userStatus.user?.id);
    const text = body.text || '👋 Test réussi ! Votre bot IA YÉ est bien connecté et prêt.';
    if (to) {
      const success = await whatsappBaileys.sendMessage(to, text);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success, to, text }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Numéro destinataire non spécifié' }));
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
    const channel=parsed?channelFor('whatsapp',parsed.recipientPhoneId):null;
    if(parsed&&!channel){res.writeHead(503);res.end('Canal non connecté');return;}

    if (parsed && parsed.text && !yeBrain.sessionManager.isDuplicateMessage('wa:'+parsed.messageId)) {
      console.log(`[WhatsApp In] De ${parsed.from} (${parsed.userName}) : "${parsed.text}"`);

      // Traitement IA via DeepSeek avec le nom de l'utilisateur
      const reply = await yeBrain.processMessage(`whatsapp:${parsed.from}`, parsed.text, 'whatsapp', { userName: parsed.userName, merchantSlug: channel.merchantSlug, delivery: { via: 'cloud', to: parsed.from, channelId: parsed.recipientPhoneId } });
      if (reply) {
        console.log(`[WhatsApp Out] Réponse générée : "${reply}"`);
        const sent=await whatsappAdapter.sendMessage(parsed.from,reply,process.env[channel.tokenEnv],parsed.recipientPhoneId);
        if(!sent.success){res.writeHead(502);res.end('Envoi impossible');return;}
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

      const reply = await yeBrain.processMessage(`telegram:${parsed.chatId}`, parsed.text, 'telegram', { userName: parsed.fromName, delivery: { via: 'telegram', to: parsed.chatId } });
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
    const events = metaAdapter.parseIncomingWebhooks(body);
    const platform = url.pathname.replace('/webhook/', '');

    for (const parsed of events) {
      const channel=channelFor(platform,parsed.recipientId);
      if(!channel){res.writeHead(503);res.end('Canal non connecté');return;}
      if(yeBrain.sessionManager.isDuplicateMessage(platform+':'+parsed.messageId))continue;
      console.log(`[${platform.toUpperCase()} In] De ${parsed.senderId} : "${parsed.text}"`);

      const reply = await yeBrain.processMessage(`${platform}:${parsed.senderId}`, parsed.text, platform, {merchantSlug:channel.merchantSlug, delivery:{via:'meta', to:parsed.senderId, channelId:parsed.recipientId}});
      if (reply) {
        console.log(`[${platform.toUpperCase()} Out] Réponse générée : "${reply}"`);
        const sent=await metaAdapter.sendMessage(parsed.senderId,reply,process.env[channel.tokenEnv],channel);
        if(!sent.success){res.writeHead(502);res.end('Envoi impossible');return;}
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

    if(!actor.admin && botType==='custom'){res.writeHead(403);res.end();return;}
    if(body.shop){brain=yeBrain;overrides.merchantSlug=body.shop;}
    overrides.delivery={via:'web'};
    if(body.userName)overrides.userName=String(body.userName).slice(0,60);
    const reply = await brain.processMessage(`${platform}:${userId}`, userMessage, platform, overrides);
    registry.sync(yeBrain.merchantCache);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, reply, humanMode: reply === null && brain === yeBrain, platform, botType }));
    return;
  }

  // 6.B. CHAT WEB : réponses de l'équipe en attente (GET /api/chat/pending)
  if (req.method === 'GET' && url.pathname === '/api/chat/pending') {
    const shopSlug = url.searchParams.get('shop') || yeEducationConfig.id;
    const id = Inbox.idFor(url.searchParams.get('platform') || 'web', url.searchParams.get('userId') || '');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, messages: yeBrain.inbox.takeWeb(shopSlug, id) }));
    return;
  }

  // 7.C. BOÎTE DE RÉCEPTION UNIFIÉE
  // L'accès est déjà limité à l'entreprise du compte connecté par le contrôle commun des routes /api/.
  if (url.pathname.startsWith('/api/inbox')) {
    const shopSlug = url.searchParams.get('shop');
    if (!yeBrain.getMerchantConfig(shopSlug)) { res.writeHead(404); res.end('{}'); return; }
    const inbox = yeBrain.inbox, body = req.parsedBody || {};
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const id = String(url.searchParams.get('id') || body.id || '');

    if (url.pathname === '/api/inbox' && req.method === 'GET') {
      return send(200, { success: true, ...inbox.list(shopSlug, {
        filter: url.searchParams.get('filter') || 'all',
        q: url.searchParams.get('q') || '',
        platform: url.searchParams.get('platform') || ''
      }) });
    }
    if (url.pathname === '/api/inbox/conversation' && req.method === 'GET') {
      if (!inbox.markRead(shopSlug, id)) return send(404, { success: false, error: 'Conversation introuvable' });
      return send(200, { success: true, conversation: inbox.detail(shopSlug, id) });
    }
    if (url.pathname === '/api/inbox/reply' && req.method === 'POST') {
      const conv = inbox.get(shopSlug, id);
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!conv) return send(404, { success: false, error: 'Conversation introuvable' });
      if (!text) return send(400, { success: false, error: 'Message vide' });
      if (!inbox.canReplyFreely(conv)) return send(409, { success: false, error: 'Plus de 24 h depuis le dernier message du client : le réseau impose un modèle de message approuvé.' });
      const agent = String(body.agent || '').trim().slice(0, 40) || 'Équipe';
      const result = await deliverAgentMessage(shopSlug, conv, text);
      if (!result.success) return send(502, { success: false, error: result.error || 'Envoi impossible' });
      if (inbox.effectiveStatus(conv) !== 'human') inbox.setStatus(shopSlug, id, 'human', agent);
      inbox.recordOutgoing(shopSlug, id, { from: 'agent', text, agent });
      yeBrain.recordAgentMessage(conv.sessionKey, text);
      return send(200, { success: true, conversation: inbox.detail(shopSlug, id) });
    }
    if (url.pathname === '/api/inbox/status' && req.method === 'POST') {
      try {
        const conv = inbox.setStatus(shopSlug, id, String(body.status || ''), String(body.agent || '').slice(0, 40) || null);
        if (!conv) return send(404, { success: false, error: 'Conversation introuvable' });
        return send(200, { success: true, conversation: inbox.detail(shopSlug, id) });
      } catch (e) { return send(400, { success: false, error: e.message }); }
    }
    if (url.pathname === '/api/inbox/update' && req.method === 'POST') {
      const conv = inbox.update(shopSlug, id, { note: body.note, tags: body.tags });
      if (!conv) return send(404, { success: false, error: 'Conversation introuvable' });
      return send(200, { success: true, conversation: inbox.detail(shopSlug, id) });
    }
    return send(404, { success: false, error: 'Route inconnue' });
  }

  // 7. HISTORIQUE DES CONVERSATIONS EN DIRECT (GET /api/merchants/conversations)
  if (url.pathname === '/api/merchants/conversations' && req.method === 'GET') {
    const shopSlug = url.searchParams.get('shop') || 'boutique_mode';
    const list = yeBrain.getMerchantConversations(shopSlug);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: list.length, conversations: list }));
    return;
  }

  // 7.B. STATISTIQUES ET ANALYSE (GET /api/analytics, GET /api/analytics/export)
  // Le contrôle d'accès commun aux routes /api/ garantit qu'un commerçant ne lit que sa propre entreprise.
  if (url.pathname === '/api/analytics' && req.method === 'GET') {
    const shopSlug = url.searchParams.get('shop');
    if (!yeBrain.getMerchantConfig(shopSlug)) { res.writeHead(404); res.end('{}'); return; }
    const summary = yeBrain.analytics.summary(shopSlug, { days: url.searchParams.get('days') });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, ...summary }));
    return;
  }

  if (url.pathname === '/api/analytics/export' && req.method === 'GET') {
    const shopSlug = url.searchParams.get('shop');
    if (!yeBrain.getMerchantConfig(shopSlug)) { res.writeHead(404); res.end(); return; }
    const days = url.searchParams.get('days') || 30;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="statistiques-${shopSlug.slice(0, 40)}-${days}j.csv"`,
      'Cache-Control': 'no-store'
    });
    res.end(yeBrain.analytics.toCsv(shopSlug, { days }));
    return;
  }

  // 8. INSCRIPTION AUTONOME DU COMMERÇANT (POST /api/merchants/register)
  if (req.method === 'POST' && url.pathname === '/api/merchants/register') {
    const body = await parseJsonBody(req);
    const businessName = body.businessName || 'Ma Boutique';
    const botName = body.botName || 'Sarah';
    const logoUrl = body.logoUrl || '';
    const managerPhone = body.managerPhone || '';
    const city = body.city || 'Yaoundé';
    const deliveryTerms = body.deliveryTerms || 'Livraison disponible';
    const catalog = body.catalog || [];
    const customDocs = body.customDocs || '';
    const customPrompt = body.customPrompt || '';

    // Génération automatique du slug unique
    const rawSlug = businessName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 25);
    const slug = rawSlug+'_'+randomUUID();

    const merchantData = {
      businessName,
      botName,
      logoUrl,
      managerPhone,
      city,
      deliveryTerms,
      catalog,
      customDocs,
      systemPrompt: customPrompt || `Tu es ${botName}, le conseiller de vente chaleureux et dynamique de "${businessName}" à ${city}. Présente les articles, informe sur la livraison (${deliveryTerms}) et prends les commandes.`,
      credits_remaining: 20,
      total_messages_processed: 0,
      recentConversations: []
    };

    // Enregistrement en mémoire instantanée
    const accessToken=registry.create(slug,merchantData);
    yeBrain.registerMerchant(slug, merchantData);

    const host = req.headers.host || 'plateforme-bots-multicanal-production.up.railway.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      slug: slug,
      accessToken,
      businessName: businessName,
      botName: botName,
      logoUrl: logoUrl,
      links: {
        telegram: '',
        webChat: `${protocol}://${host}/?shop=${slug}`,
        dashboard: `${protocol}://${host}/dashboard?shop=${slug}`,
        qrCodeUrl: ''
      },
      message: 'Identité créée. Les canaux sociaux doivent être connectés séparément à cette entreprise.'
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
  }catch(error){console.error(error.message);if(!res.headersSent)res.writeHead(400);res.end('Requête invalide');}
});

async function parseJsonBody(req) {
  if(req.parsedBody)return req.parsedBody;
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('Requête trop volumineuse');chunks.push(chunk);}
  req.rawBody=Buffer.concat(chunks);
  const body=JSON.parse(req.rawBody.toString('utf8')||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Objet JSON requis');
  return body;
}

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 SERVEUR DE BOTS IA OMNICANAUX ACTIF (DEEPSEEK)`);
  console.log(`🌐 Accédez au simulateur sur : http://localhost:${PORT}`);
  console.log(`📱 Tableau de bord & Scan WhatsApp : http://localhost:${PORT}/dashboard`);
  console.log(`📱 Webhooks WhatsApp Cloud : http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`📱 Webhooks Telegram : http://localhost:${PORT}/webhook/telegram`);
  console.log(`======================================================\n`);
});

