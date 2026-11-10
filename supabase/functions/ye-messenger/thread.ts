export function threadContext(items: any[], targetId: string, pageId: string) {
 const ordered=[...new Map(items.map(item=>[String(item.id),item])).values()]
  .sort((a,b)=>Date.parse(a.created_time)-Date.parse(b.created_time));
 const position=ordered.findIndex(item=>String(item.id)===targetId);
 if(position<0)throw Error('thread_target_missing');
 const target=ordered[position];
 const answered=ordered.some(item=>String(item.from?.id)===pageId &&
  String(item.parent?.id)===targetId && Date.parse(item.created_time)>=Date.parse(target.created_time)) ||
  String(ordered[position+1]?.from?.id)===pageId;
 return {answered, history:ordered.slice(Math.max(0,position-12),position).map(item=>({
  role:String(item.from?.id)===pageId?'Page YE':'visiteur',
  sameVisitor:String(item.from?.id)===String(target.from?.id),
  text:String(item.message||'').slice(0,1000)
 }))};
}

export async function publicThread(comment: any, postId: string, pageId: string,
 read: (id: string,fields: string)=>Promise<any>) {
 let root=comment;
 for(let depth=0;root.parent?.id && root.parent.id!==postId;depth++) {
  if(depth>=5)throw Error('thread_depth_limit');
  root=await read(String(root.parent.id),'id,message,from,parent,created_time');
 }
 const items=[root,comment];
 let after='';
 for(let page=0;page<10;page++) {
  const result=await read(root.id+'/comments','id,message,from,parent,created_time&limit=100&order=chronological'+(after?'&after='+encodeURIComponent(after):''));
  items.push(...(result.data||[]));
  if(!result.paging?.next)return threadContext(items,String(comment.id),pageId);
  after=result.paging?.cursors?.after;
  if(!after)throw Error('thread_cursor_missing');
 }
 throw Error('thread_too_large');
}
