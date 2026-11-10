import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const adb='C:/Users/hp/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const home='/data/data/com.termux/files/home',dest=home+'/ye-bot';
function run(args,input){const r=spawnSync(adb,['-s','4a68cb3d',...args],{input,maxBuffer:1024*1024});if(r.status!==0)throw Error('USB operation failed');}
function put(file,data){run(['shell','run-as','com.termux','mkdir','-p',file.slice(0,file.lastIndexOf('/'))]);run(['shell',`run-as com.termux sh -c 'umask 077; cat > ${file}; chmod 600 ${file}'`],Buffer.from(data));}
const secrets=fs.readFileSync('.private/hosting.env','utf8');
const key=secrets.match(/^DEEPSEEK_API_KEY=(.+)$/m)?.[1];if(!key)throw Error('Clé IA absente');
put(dest+'/.private/hosting.env','DEEPSEEK_API_KEY='+key.trim()+'\n');
const local='.private/whatsapp-673676864';
const archive=spawnSync('tar.exe',['-cf','-','-C',local,'session'],{maxBuffer:256*1024*1024});
if(archive.status!==0)throw Error('Archive session échouée');
run(['shell','run-as','com.termux','mkdir','-p',dest+'/'+local]);
run(['shell',`run-as com.termux sh -c 'umask 077; tar -xf - -C ${dest}/${local}'`],archive.stdout);
for(const name of ['limits.json','inbox.json'])if(fs.existsSync(local+'/'+name))put(dest+'/'+local+'/'+name,fs.readFileSync(local+'/'+name));
const supervisor=`#!/data/data/com.termux/files/usr/bin/bash
export HOME=${home}
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:/system/bin
cd "$HOME/ye-bot"
umask 077
exec 9>.private/run.lock
flock -n 9 || exit 0
termux-wake-lock
while true; do
 node scripts/whatsapp-qr-pilot.mjs >> .private/runtime.log 2>&1
 sleep 30
done
`;
put(dest+'/run.sh',supervisor);
put(home+'/.termux/boot/10-ye-bot',`#!/data/data/com.termux/files/usr/bin/bash\ntermux-wake-lock\nnohup bash ${dest}/run.sh >/dev/null 2>&1 &\n`);
run(['shell','run-as','com.termux','chmod','700',home+'/.termux/boot/10-ye-bot',dest+'/run.sh']);
console.log('Session, clé et démarrage automatique transférés par USB privé.');
