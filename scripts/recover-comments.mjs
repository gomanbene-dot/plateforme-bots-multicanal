import fs from 'node:fs';
import {threadContext} from '../supabase/functions/ye-messenger/thread.ts';
const config={};
for(const file of ['.private/hosting.env','.private/META-A-COMPLETER.env'])for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)config[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
}
const page=config.YE_META_PAGE_ID,base='https://graph.facebook.com/v23.0/';
async function graph(path,params){
 const url=new URL(base+path);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+config.YE_META_PAGE_TOKEN},signal:AbortSignal.timeout(20000)});
 if(!r.ok){const b=await r.json();throw Error('graph_'+r.status+'_'+b.error?.code+'_'+b.error?.message);}
 return r.json();
}
async function all(path,fields,extra={}){
 const out=[];let after='';
 for(let n=0;n<100;n++){
  const b=await graph(path,{fields,limit:'100',...extra,...(after?{after}:{})});out.push(...b.data||[]);
  if(!b.paging?.next)return out;
  after=b.paging?.cursors?.after;if(!after)throw Error('missing_cursor');
 }
 throw Error('pagination_limit');
}
const report={posts:0,comments:0,pageComments:0,answered:0,unavailable:0,missingAuthor:0,empty:0,hidden:0,candidates:0,queued:0};
const candidates=[];
for(const post of await all(page+'/posts','id')){
 report.posts++;
 const comments=await all(post.id+'/comments','id,message,from,parent,created_time,is_hidden',{filter:'stream',order:'chronological'});
 for(const c of comments)if(!c.from?.id)Object.assign(c,await graph(c.id,{fields:'id,message,from,parent,created_time,is_hidden'}));
 report.comments+=comments.length;
 const map=new Map(comments.map(c=>[c.id,c]));
 const root=(c)=>{const seen=new Set();while(c.parent?.id&&map.has(c.parent.id)){if(seen.has(c.id))throw Error('cycle');seen.add(c.id);c=map.get(c.parent.id);}return c.id;};
 for(const c of comments){
  if(c.from?.id===page){report.pageComments++;continue;}
  if(!c.from?.id||!c.message||c.is_hidden){report.unavailable++;if(!c.from?.id)report.missingAuthor++;if(!c.message)report.empty++;if(c.is_hidden)report.hidden++;continue;}
  const thread=comments.filter(item=>root(item)===root(c));
  if(threadContext(thread,c.id,page).answered){report.answered++;continue;}
  candidates.push({id:c.id,postId:post.id,author:c.from.id,message:c.message,created_time:c.created_time});
 }
}
report.candidates=candidates.length;
const endpoint='https://fcowwopbzkmjdyhqyufw.supabase.co/functions/v1/ye-messenger';
if(process.argv.includes('--enqueue')){
 const setup=await fetch(endpoint+'/admin/setup',{method:'POST',headers:{Authorization:'Bearer '+config.YE_BOT_ADMIN_TOKEN}});
 if(!setup.ok)throw Error('schedule_http_'+setup.status);
 for(let i=0;i<candidates.length;i+=50){
  const r=await fetch(endpoint+'/admin/recover-comments',{method:'POST',headers:{Authorization:'Bearer '+config.YE_BOT_ADMIN_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({comments:candidates.slice(i,i+50)})});
  if(!r.ok)throw Error('queue_http_'+r.status);report.queued+=(await r.json()).queued;
 }
}
console.log(JSON.stringify(report));
