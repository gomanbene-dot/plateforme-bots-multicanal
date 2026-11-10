import test from 'node:test';
import assert from 'node:assert/strict';
import {extractComments,parseCommentDecision} from './supabase/functions/ye-messenger/comments.ts';
test('Commentaires : page, âge, auteur et niveau de réponse contrôlés',()=>{
 const now=Date.now();
 const value={item:'comment',verb:'add',post_id:'123_456',comment_id:'456_789',parent_id:'123_456',from:{id:'42'},message:'Comment installer YE ?',created_time:Math.floor(now/1000)};
 const extract=(v=value,id='123')=>extractComments({object:'page',entry:[{id,time:now/1000,changes:[{field:'feed',value:v}]}]},'123',now);
 assert.equal(extract().length,1);
 for(const v of [{...value,from:{id:'123'}},{...value,verb:'remove'},{...value,post_id:'999_456'},{...value,message:''},{...value,created_time:(now-25*3600000)/1000}]) assert.equal(extract(v).length,0);
 assert.equal(extract({...value,parent_id:'456_999'}).length,1);
 assert.equal(extract(value,'999').length,0);
 assert.equal(extract()[0].id,extract()[0].id); // Stable key for database deduplication.
 assert.ok(extract()[0].sender_id.startsWith('comment:')); // No private conversation history.
});
test('Réponse publique : décision structurée obligatoire et taille limitée',()=>{
 assert.deepEqual(parseCommentDecision('{"action":"reply","reply":" Ouvrez le lien YE. "}'),{action:'reply',reply:'Ouvrez le lien YE.'});
 assert.deepEqual(parseCommentDecision('{"action":"review","reply":"ne pas publier"}'),{action:'review',reply:''});
 assert.throws(()=>parseCommentDecision('réponse libre'));
 assert.throws(()=>parseCommentDecision('{"action":"delete","reply":""}'));
 assert.throws(()=>parseCommentDecision(JSON.stringify({action:'reply',reply:'x'.repeat(901)})));
});
test('Commentaires : un seul paragraphe et au plus 280 caractères',()=>{
 const short=parseCommentDecision(JSON.stringify({action:'reply',reply:'Bonjour.\n\nLes cours commencent à 100 FCFA pour 1 jour.'}));
 assert.equal(short.reply,'Bonjour. Les cours commencent à 100 FCFA pour 1 jour.');
 const long=parseCommentDecision(JSON.stringify({action:'reply',reply:'Une réponse utile. '.repeat(30)}));
 assert.ok(long.reply.length<=280);
 assert.ok(!long.reply.includes('\n'));
});
