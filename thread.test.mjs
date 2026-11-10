import test from 'node:test';
import assert from 'node:assert/strict';
import {threadContext,publicThread} from './supabase/functions/ye-messenger/thread.ts';
import {isConversationClosed,FOLLOWUP_RULES} from './supabase/functions/ye-messenger/comments.ts';
const c=(id,author,second,parent)=>({id,from:{id:author},message:'texte '+id,created_time:new Date(second*1000).toISOString(),parent:parent?{id:parent}:undefined});
test('Une clôture ne masque pas une nouvelle question',()=>{
 for(const s of ['Merci !','OK merci','Merci beaucoup 🙏','Au revoir.'])assert.equal(isConversationClosed(s),true);
 for(const s of ['Merci, mais comment installer ?','Ça marche pas','Quel prix ?'])assert.equal(isConversationClosed(s),false);
 assert.ok(FOLLOWUP_RULES.includes('https://yeme-3df34.web.app/installer.html'));
});
test('Historique public : suivi, réponses existantes, autres visiteurs',()=>{
 const items=[c('1','user',1),c('2','page',2,'1'),c('3','user',3,'1'),c('4','other',4,'1')];
 assert.equal(threadContext(items,'1','page').answered,true);
 const follow=threadContext(items,'3','page');
 assert.equal(follow.answered,false);
 assert.equal(follow.history.length,2);
 assert.equal(follow.history[1].role,'Page YE');
 assert.equal(follow.history[0].sameVisitor,true);
 assert.equal(threadContext([...items,c('5','page',5,'3')],'3','page').answered,true);
});
test('Lecture du fil paginée, sans messages privés',async()=>{
 const root=c('1','user',1),target=c('3','user',3,'1');let calls=0;
 const result=await publicThread(target,'post','page',async(id,fields)=>{
  calls++;
  if(id==='1')return root;
  assert.equal(id,'1/comments');
  if(fields.includes('after='))return {data:[target]};
  return {data:[c('2','page',2,'1')],paging:{next:'not-followed',cursors:{after:'cursor'}}};
 });
 assert.equal(calls,3);assert.equal(result.answered,false);assert.equal(result.history.length,2);
});
