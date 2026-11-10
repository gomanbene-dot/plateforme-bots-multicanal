import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {validSignature,extractMessages} from './supabase/functions/ye-messenger/security.ts';
test('signature Meta obligatoire et corps non modifié',async()=>{
 const body='{"object":"page"}',secret='test-secret',sig='sha256='+createHmac('sha256',secret).update(body).digest('hex');
 assert.equal(await validSignature(body,sig,secret),true);
 assert.equal(await validSignature(body+' ',sig,secret),false);
 assert.equal(await validSignature(body,sig,''),false);
 assert.equal(await validSignature(body,'',secret),false);
});
test('page correcte, pas de réponse aux échos ou messages périmés',()=>{
 const now=Date.now(),event={timestamp:now,sender:{id:'visitor'},recipient:{id:'ye'},message:{mid:'one',text:'Installer YE'}};
 const body={object:'page',entry:[{id:'ye',messaging:[event,{...event,message:{...event.message,is_echo:true}},{...event,timestamp:now-25*3600000},{...event,recipient:{id:'other'}}]},{id:'other',messaging:[event]}]};
 assert.equal(extractMessages(body,'ye',now).length,1);
 assert.equal(extractMessages(body,'different',now).length,0);
 assert.equal(extractMessages({...body,object:'instagram'},'ye',now).length,0);
});
