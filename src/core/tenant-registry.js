
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
export class TenantRegistry {
  constructor(dir = process.env.BOT_DATA_DIR || path.resolve('.private')) {
    this.dir=dir; fs.mkdirSync(dir,{recursive:true});
    this.file=path.join(dir,'tenants.json');
    const keyFile=path.join(dir,'admin-access.txt');
    if(!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,randomBytes(32).toString('hex'),{mode:0o600});
    this.adminHash=hash(fs.readFileSync(keyFile,'utf8').trim());
    this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{};
  }
  authenticate(token='') {
    const candidate=hash(token);
    const equal=h=>typeof h==='string' && h.length===candidate.length && timingSafeEqual(Buffer.from(h),Buffer.from(candidate));
    if(equal(this.adminHash))return {admin:true,slug:'ye_almanach'};
    const slug=Object.keys(this.data).find(s=>equal(this.data[s].accessHash));
    return slug?{admin:false,slug}:null;
  }
  create(slug,config) {
    if(this.data[slug])throw Error('Entreprise déjà existante');
    const token=randomBytes(32).toString('hex');
    this.data[slug]={accessHash:hash(token),config};this.persist();return token;
  }
  sync(cache) {
    for(const [slug,config] of cache)if(this.data[slug])this.data[slug].config={...config,recentConversations:[]};
    this.persist();
  }
  persist(){
    fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2),{mode:0o600});
    fs.renameSync(this.file+'.tmp',this.file);
  }
}
