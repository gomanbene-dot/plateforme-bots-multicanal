import { extractComments, PUBLIC_COMMENT_RULES, FOLLOWUP_RULES, FACEBOOK_INSTALL_RULE, isConversationClosed, parseCommentDecision } from './comments.ts';
import { BOT_PRIVACY } from './privacy.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { validSignature,extractMessages } from './security.ts';
import { YE_CONTEXT } from './context.ts';
import { publicThread } from './thread.ts';

const env=(key:string)=>Deno.env.get(key)||'';
const pageId=env('YE_META_PAGE_ID')||'1191324310740541';
const enabled=()=>env('YE_BOT_ENABLED')==='true';
const configured=()=>!!(env('YE_META_PAGE_TOKEN')&&env('YE_META_APP_SECRET')&&env('YE_META_VERIFY_TOKEN')&&env('DEEPSEEK_API_KEY'));
const db=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function administrator(req:Request){
 const value=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!value||!env('YE_BOT_ADMIN_TOKEN'))return false;
 const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
 const a=await digest(value),b=await digest(env('YE_BOT_ADMIN_TOKEN'));let diff=0;
 for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
async function boundedText(req:Request){
 const reader=req.body?.getReader();if(!reader)return '';let bytes=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>200000){await reader.cancel();throw Error('payload_too_large');}chunks.push(value);}
 const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}return new TextDecoder().decode(all);
}
async function generate(question:string,history:any[]=[],publicComment=false){
 const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${env('DEEPSEEK_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({model:env('YE_DEEPSEEK_MODEL')||'deepseek-chat',max_tokens:500,temperature:.2,messages:[{role:'system',content:YE_CONTEXT+(publicComment?'\n'+FOLLOWUP_RULES+'\n'+PUBLIC_COMMENT_RULES:'')},...history,{role:'user',content:question}]})});
 if(!r.ok)throw Error(`ai_http_${r.status}`);
 const b=await r.json(),reply=b.choices?.[0]?.message?.content;
 if(typeof reply!=='string'||!reply.trim())throw Error('ai_empty_reply');if(publicComment)return reply.trim();
 const short=reply.replace(/\s+/g,' ').trim();
 if(short.length<=450)return short;
 const part=short.slice(0,447);return part.slice(0,part.lastIndexOf(' '))+'…';
}
async function work(){
 if(!enabled()||!configured())return;
 const client=db();
 for(let i=0;i<3;i++){
  const claim=await client.rpc('ye_bot_claim',{p_page:pageId});if(claim.error)throw Error('queue_unavailable');
  const message=claim.data?.[0];if(!message)return;
  let sending=false;
  try{
   if(message.id.startsWith('comment:')) {
    if(env('YE_COMMENTS_ENABLED')!=='true') {
     await client.from('ye_bot_messages').update({status:'review',error_code:'comments_not_enabled'}).eq('id',message.id); continue;
    }
    const [,commentId,postId]=message.id.split(':');
    const graph='https://graph.facebook.com/'+(env('YE_META_GRAPH_VERSION')||'v23.0');
    const headers={Authorization:'Bearer '+env('YE_META_PAGE_TOKEN')};
    const read=async(id:string,fields:string)=>{
     const response=await fetch(graph+'/'+id+'?fields='+fields,{headers,signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw Error('comment_read_http_'+response.status);
     return response.json();
    };
    const comment=await read(commentId,'id,message,from,is_hidden,parent,created_time');
    if(comment.from?.id===pageId || comment.is_hidden || !comment.message) {
     await client.from('ye_bot_messages').update({status:'ignored',error_code:'comment_unavailable'}).eq('id',message.id); continue;
    }
    if(isConversationClosed(comment.message)) {
     await client.from('ye_bot_messages').update({status:'ignored',error_code:'conversation_closed'}).eq('id',message.id); continue;
    }
    const thread=await publicThread(comment,postId,pageId,read);
    if(thread.answered) {
     await client.from('ye_bot_messages').update({status:'ignored',error_code:'already_answered_on_facebook'}).eq('id',message.id); continue;
    }
    const post=await read(postId,'id,message');
    const decision=parseCommentDecision(await generate(JSON.stringify({publication:String(post.message||'').slice(0,4000),fil_public:thread.history,commentaire:String(comment.message).slice(0,2000)}),[{role:'system',content:FACEBOOK_INSTALL_RULE}],true));
    if(decision.action!=='reply') {
     await client.from('ye_bot_messages').update({status:decision.action==='review'?'review':'ignored',error_code:'comment_'+decision.action}).eq('id',message.id); continue;
    }
    const saved=await client.from('ye_bot_messages').update({reply:decision.reply}).eq('id',message.id);
    if(saved.error)throw Error('save_reply_failed');
    sending=true;
    const response=await fetch(graph+'/'+commentId+'/comments',{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({message:decision.reply})});
    if(!response.ok)throw Error('comment_send_http_'+response.status);
    if(!(await response.json()).id)throw Error('comment_send_unconfirmed');
    const done=await client.from('ye_bot_messages').update({status:'sent',error_code:null}).eq('id',message.id);
    if(done.error)throw Error('save_delivery_failed');
    continue;
   }
   const historyResult=await client.from('ye_bot_messages').select('question,reply').eq('sender_id',message.sender_id).eq('page_id',pageId).eq('status','sent').order('received_at',{ascending:false}).limit(3);
   if(historyResult.error)throw Error('history_unavailable');
   const history=(historyResult.data||[]).reverse().flatMap((m:any)=>[{role:'user',content:m.question},{role:'assistant',content:m.reply}]);
   const reply=await generate(message.question,history);
   // Sauver le texte avant l’envoi permet la revue des résultats ambigus sans relance automatique.
   const saved=await client.from('ye_bot_messages').update({reply}).eq('id',message.id);if(saved.error)throw Error('save_reply_failed');
   sending=true;
   const response=await fetch(`https://graph.facebook.com/${env('YE_META_GRAPH_VERSION')||'v23.0'}/${pageId}/messages`,{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${env('YE_META_PAGE_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:message.sender_id},messaging_type:'RESPONSE',message:{text:reply}})});
   if(!response.ok)throw Error(`messenger_http_${response.status}`);
   const sent=await response.json();if(!sent.message_id)throw Error('messenger_unconfirmed');
   const updated=await client.from('ye_bot_messages').update({status:'sent',error_code:null}).eq('id',message.id);if(updated.error)throw Error('save_delivery_failed');
  }catch(error){
   const code=error instanceof Error?error.message:'unexpected_error';
   await client.from('ye_bot_messages').update({status:sending?'review':'failed',error_code:code.slice(0,100)}).eq('id',message.id);
   console.error('YE delivery failed',message.id,code);
  }
 }
}
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url);
 if(req.method==='GET' && ['/privacy','/data-deletion'].some(p=>url.pathname.endsWith(p))) return new Response(BOT_PRIVACY,{headers:{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}});
 try{
  if(req.method==='GET'&&url.pathname.endsWith('/health'))return json({server:'ready',messenger:enabled()&&configured()?'enabled_pending_live_test':'not_connected'});
  if(url.pathname.endsWith('/admin/status')){
   if(!await administrator(req))return json({error:'unauthorized'},401);
   const result=await db().from('ye_bot_messages').select('status,error_code,received_at').order('received_at',{ascending:false}).limit(30);
   return json({enabled:enabled(),pageId,configured:configured(),missing:['YE_META_PAGE_TOKEN','YE_META_APP_SECRET','YE_META_VERIFY_TOKEN','DEEPSEEK_API_KEY'].filter(k=>!env(k)),recent:result.data||[],database:result.error?'error':'ready',dailyLimit:100,commentsEnabled:env('YE_COMMENTS_ENABLED')==='true'});
  }
  if(req.method==='POST'&&url.pathname.endsWith('/worker')){
   if(!await administrator(req))return json({error:'unauthorized'},401);
   EdgeRuntime.waitUntil(work().catch(e=>console.error('YE worker failed',e.message)));
   return json({ok:true,enabled:enabled()});
  }
  if(req.method==='POST'&&url.pathname.endsWith('/admin/recover-comments')){
   if(!await administrator(req))return json({error:'unauthorized'},401);
   const input=JSON.parse(await boundedText(req));
   if(!Array.isArray(input.comments)||input.comments.length>50)return json({error:'invalid_batch'},400);
   const rows=input.comments.map((c:any)=>{
    if(!/^\d+_\d+$/.test(c.id)||!/^\d+_\d+$/.test(c.postId)||!c.postId.startsWith(pageId+'_')||!/^\d+$/.test(c.author)||c.author===pageId||typeof c.message!=='string'||!c.message.trim()||!Number.isFinite(Date.parse(c.created_time)))throw Error('invalid_comment');
    return {id:`comment:${c.id}:${c.postId}`,page_id:pageId,sender_id:`comment:${c.author}`,question:c.message.slice(0,2000),event_at:c.created_time};
   });
   const result=await db().from('ye_bot_messages').upsert(rows,{onConflict:'id',ignoreDuplicates:true}).select('id');
   if(result.error)return json({error:'queue_unavailable'},503);
   return json({queued:result.data?.length||0});
  }
  if(req.method==='POST'&&url.pathname.endsWith('/admin/setup')){
   if(!await administrator(req))return json({error:'unauthorized'},401);
   const result=await db().rpc('ye_bot_schedule',{p_token:env('YE_BOT_ADMIN_TOKEN')});
   if(result.error)return json({error:'scheduler_setup_failed'},503);
   return json({ok:true});
  }
  if(req.method==='POST'&&url.pathname.endsWith('/admin/test')){
   if(!await administrator(req))return json({error:'unauthorized'},401);
   const raw=await boundedText(req);const input=raw?JSON.parse(raw):{};
   const question=typeof input.question==='string'?input.question.slice(0,2000):'Présente YE en une phrase et donne son lien d’installation.';
   return json({reply:await generate(question),sentToMessenger:false});
  }
  if(req.method==='GET'){
   if(url.searchParams.get('hub.mode')==='subscribe'&&env('YE_META_VERIFY_TOKEN')&&url.searchParams.get('hub.verify_token')===env('YE_META_VERIFY_TOKEN'))return new Response(url.searchParams.get('hub.challenge')||'');
   return json({error:'verification_required'},403);
  }
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const raw=await boundedText(req);
  if(!await validSignature(raw,req.headers.get('x-hub-signature-256')||'',env('YE_META_APP_SECRET')))return json({error:'invalid_signature'},403);
  if(!enabled()||!configured())return json({error:'channel_not_enabled'},503);
  const body=JSON.parse(raw);
  const messages=[...extractMessages(body,pageId),...(env('YE_COMMENTS_ENABLED')==='true'?extractComments(body,pageId):[])];
  if(messages.length){
   const inserted=await db().from('ye_bot_messages').upsert(messages,{onConflict:'id',ignoreDuplicates:true});if(inserted.error)return json({error:'queue_unavailable'},503);
   EdgeRuntime.waitUntil(work().catch(e=>console.error('YE worker failed',e.message)));
  }
  return new Response('EVENT_RECEIVED');
 }catch{return json({error:'request_failed'},400);}
});
