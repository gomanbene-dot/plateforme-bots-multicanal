import fs from 'node:fs';
const env={};
for(const file of ['.private/hosting.env','.private/META-A-COMPLETER.env']){
 for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
  const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&m[2].trim())env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
 }
}
for(const question of ['Bonjour','Quelles sont les causes de la Première Guerre mondiale ?','La bibliothèque sert à quoi et combien coûte-t-elle ?','Si je paie 1500 F à chaque renouvellement, vous offrez un mois ?']){
 const r=await fetch('https://fcowwopbzkmjdyhqyufw.supabase.co/functions/v1/ye-messenger/admin/test',{method:'POST',headers:{Authorization:'Bearer '+env.YE_BOT_ADMIN_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({question}),signal:AbortSignal.timeout(40000)});
 if(!r.ok)throw Error('Test HTTP '+r.status);
 const data=await r.json();console.log(JSON.stringify({question,...data}));
}
