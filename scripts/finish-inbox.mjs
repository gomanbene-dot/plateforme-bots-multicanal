import fs from 'node:fs';
const p='scripts/whatsapp-qr-pilot.mjs';
let s=fs.readFileSync(p,'utf8');
s=s.replace("async function send(jid,text){if(!ready)throw Error('Déconnecté');if(activeJob)","async function send(jid,text,track=true){if(!ready)throw Error('Déconnecté');if(track&&activeJob)");
s=s.replace("une seule fois par compte.').catch","une seule fois par compte.',false).catch");
s=s.replace('Les conversations récentes restent en mémoire jusqu’à l’arrêt.','Le contexte récent et les messages en attente sont sauvegardés localement.');
fs.writeFileSync(p,s);
for(const name of ['whatsapp-qr-pilot.mjs','whatsapp-inbox.mjs'])fs.copyFileSync('scripts/'+name,'termux-package/scripts/'+name);
