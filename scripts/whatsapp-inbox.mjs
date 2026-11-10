import fs from 'node:fs';
import {createHash} from 'node:crypto';
export class Inbox {
 constructor(file, now=Date.now()) {
  this.file=file;
  this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{since:now-24*3600000,jobs:{}};
  for(const job of Object.values(this.data.jobs)) if(job.state==='sending')job.state='review';
  this.save();
 }
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 add(msg,seen=[],now=Date.now()) {
  const ts=Number(msg.messageTimestamp)*1000;
  if(!msg.key?.id||msg.key.fromMe||!Number.isFinite(ts)||ts<this.data.since||ts<now-7*86400000||ts>now+300000)return false;
  const id=createHash('sha256').update(msg.key.remoteJid+':'+msg.key.id).digest('hex');
  if(seen.includes(id)||this.data.jobs[id])return false;
  this.data.jobs[id]={msg:JSON.parse(JSON.stringify(msg)),at:ts,state:'pending'};
  this.save();return true;
 }
 next(now=Date.now()){
  for(const [id,j] of Object.entries(this.data.jobs))if(j.at<now-7*86400000)delete this.data.jobs[id];
  return Object.entries(this.data.jobs).filter(([,j])=>j.state==='pending').sort((a,b)=>a[1].at-b[1].at)[0];
 }
 set(id,state){this.data.jobs[id].state=state;this.save();}
 counts(){return Object.values(this.data.jobs).reduce((a,j)=>(a[j.state]=(a[j.state]||0)+1,a),{});}
}
