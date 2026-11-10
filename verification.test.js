
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiBrain } from './src/core/ai-brain.js';
import { TenantRegistry } from './src/core/tenant-registry.js';
import { yeEducationConfig } from './src/configs/ye-education.config.js';
import { MetaAdapter } from './src/adapters/meta.adapter.js';
import { WhatsAppAdapter } from './src/adapters/whatsapp.adapter.js';
test('Contexte YE exact',()=>{
 assert.equal(yeEducationConfig.supportEmail,'contactye@proton.me');
 assert.equal(yeEducationConfig.websiteUrl,'https://yeme-3df34.web.app/installer.html');
 assert(!yeEducationConfig.playStoreUrl);
 assert.match(yeEducationConfig.systemPrompt,/Ne jamais affirmer entièrement hors ligne/);
});
test('Entreprises et historiques séparés, entreprise inconnue refusée',async()=>{
 const brain=new AiBrain(yeEducationConfig);
 brain.registerMerchant('client_a',{businessName:'A',botName:'Alice',systemPrompt:'A seulement'});
 brain.registerMerchant('client_b',{businessName:'B',botName:'Bruno',systemPrompt:'B seulement'});
 const calls=[];brain.engine.generateResponse=async m=>{calls.push(m);return {text:'Réponse de test'};};
 await brain.processMessage('meme-visiteur','secret A','web',{merchantSlug:'client_a'});
 await brain.processMessage('meme-visiteur','question B','web',{merchantSlug:'client_b'});
 assert(!JSON.stringify(calls[1]).includes('secret A'));
 assert(!JSON.stringify(calls[1]).includes('Almanach'));
 assert.equal(brain.getMerchantConfig('inconnu'),null);
 await brain.processMessage('meme-visiteur','test','web',{merchantSlug:'inconnu'});
 assert.equal(calls.length,2);
});
test('Identité et accès persistés',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ye-bot-test-'));
 const r=new TenantRegistry(dir);
 const token=r.create('client_a',{botName:'Alice',logoUrl:'https://example.com/logo.png'});
 const next=new TenantRegistry(dir);
 assert.equal(next.authenticate(token).slug,'client_a');
 assert.equal(next.authenticate('faux'),null);
 assert.equal(next.data.client_a.config.botName,'Alice');
 assert(!fs.readFileSync(path.join(dir,'tenants.json'),'utf8').includes(token));
});
test('Meta prend tous les messages et ignore les échos',()=>{
 const m=new MetaAdapter();
 const body={entry:[{messaging:[{sender:{id:'u'},recipient:{id:'p'},message:{mid:'1',text:'Bonjour'}},{message:{mid:'2',text:'echo',is_echo:true}}]},{messaging:[{sender:{id:'v'},recipient:{id:'p'},message:{mid:'3',text:'Salut'}}]}]};
 assert.equal(m.parseIncomingWebhooks(body).length,2);
});
test('Sans connexion réseau configurée, aucun faux succès',async()=>{
 const m=new MetaAdapter();m.pageAccessToken='';
 const w=new WhatsAppAdapter();w.accessToken='';w.phoneNumberId='';
 assert.equal((await m.sendMessage('test','test')).success,false);
 assert.equal((await w.sendMessage('test','test')).success,false);
});


import { spawn } from 'node:child_process';
test('HTTP : accès privé, séparation et personnalisation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ye-http-test-'));
 const registry=new TenantRegistry(dir);
 const a=registry.create('client_a',{businessName:'A',botName:'Alice',credits_remaining:20});
 registry.create('client_b',{businessName:'B',botName:'Bruno',credits_remaining:20});
 const child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'3198',BOT_DATA_DIR:dir,ENABLE_WHATSAPP_WEB:'false',META_APP_SECRET:'test-secret',SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'test'},stdio:'ignore'});
 try{
  let ready=false;
  for(let i=0;i<160;i++){try{const r=await fetch('http://127.0.0.1:3198/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert(ready,'serveur démarré');
  const request=(p,o={})=>fetch('http://127.0.0.1:3198'+p,o);
  assert.equal((await request('/api/merchants/details')).status,401);
  assert.equal((await request('/api/merchants/details?shop=client_b',{headers:{Authorization:'Bearer '+a}})).status,403);
  const r=await request('/api/merchants/profile',{method:'POST',headers:{Authorization:'Bearer '+a,'Content-Type':'application/json'},body:JSON.stringify({shop:'client_a',botName:'Assistant A',logoUrl:'https://example.com/a.png',customDocs:'La boutique ferme dimanche.'})});
  assert.equal(r.status,200);
  const row=await (await request('/api/merchants/details?shop=client_a',{headers:{Authorization:'Bearer '+a}})).json();
  assert.equal(row.merchant.botName,'Assistant A');
  assert.equal(new TenantRegistry(dir).data.client_a.config.logoUrl,'https://example.com/a.png');
  assert.equal((await request('/webhook/messenger',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/webhook/paymooney',{method:'POST',body:'{}'})).status,503);
 } finally{child.kill();}
});


