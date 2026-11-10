import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const adb='C:/Users/hp/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const dest='/data/data/com.termux/files/home/ye-bot';
for(const file of ['scripts/whatsapp-qr-pilot.mjs','scripts/whatsapp-reconnect.mjs']){
 const result=spawnSync(adb,['-s','4a68cb3d','shell',`run-as com.termux sh -c 'umask 077; cat > ${dest}/${file}'`],{input:fs.readFileSync(file)});
 if(result.status!==0)throw Error('Transfert échoué');
}
console.log('Correctif transféré, session WhatsApp et messages conservés.');
const boot='/data/data/com.termux/files/home/.termux/boot/10-ye-bot';
const script='#!/data/data/com.termux/files/usr/bin/bash\nexec /data/data/com.termux/files/usr/bin/bash /data/data/com.termux/files/home/ye-bot/run.sh\n';
const updated=spawnSync(adb,['-s','4a68cb3d','shell',`run-as com.termux sh -c 'umask 077; cat > ${boot}; chmod 700 ${boot}'`],{input:Buffer.from(script)});
if(updated.status!==0)throw Error('Mise à jour du démarrage échouée');
