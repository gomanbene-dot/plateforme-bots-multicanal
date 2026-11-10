import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const adb='C:/Users/hp/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const dest='/data/data/com.termux/files/home/ye-bot';
function run(args,input){const r=spawnSync(adb,['-s','4a68cb3d',...args],{input,encoding:input?undefined:'utf8',maxBuffer:20*1024*1024});if(r.status!==0)throw Error('Transfert USB échoué');return r;}
run(['shell','run-as','com.termux','mkdir','-p',dest]);
// Direct USB stream into app-private storage. No secrets in shared Downloads.
for(const file of ['package.json','package-lock.json','scripts/whatsapp-qr-pilot.mjs','scripts/whatsapp-routing.mjs','scripts/whatsapp-inbox.mjs','src/configs/ye-education.config.js']){
 run(['shell','run-as','com.termux','mkdir','-p',dest+'/'+path.posix.dirname(file)]);
 run(['shell',`run-as com.termux sh -c 'cat > ${dest}/${file}'`],fs.readFileSync(file));
}
const setup=`#!/data/data/com.termux/files/usr/bin/bash
set -e
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:/system/bin
cd "$HOME/ye-bot"
npm ci --omit=dev > install.log 2>&1
echo INSTALL_OK
`;
run(['shell',`run-as com.termux sh -c 'cat > ${dest}/setup.sh'`],Buffer.from(setup));
console.log('Programme transféré dans le stockage privé de Termux.');
