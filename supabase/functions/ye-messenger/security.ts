export async function validSignature(raw: string, signature: string, secret: string) {
 if(!secret || !/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.slice(7).match(/../g)!,h=>parseInt(h,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw));
}
export function extractMessages(body:any,pageId:string,now=Date.now()) {
 const found=[];
 if(body.object!=='page')return found;
 for(const entry of body.entry||[])for(const e of entry.messaging||[]) {
  if(String(entry.id)!==pageId||String(e.recipient?.id)!==pageId||e.message?.is_echo)continue;
  if(!e.message?.mid||!e.sender?.id||typeof e.message.text!=='string'||!e.message.text.trim())continue;
  if(!Number.isFinite(e.timestamp)||e.timestamp<now-23*3600000||e.timestamp>now+300000)continue;
  found.push({id:e.message.mid,page_id:pageId,sender_id:String(e.sender.id),question:e.message.text.trim().slice(0,2000),event_at:new Date(e.timestamp).toISOString()});
 }
 return found;
}
