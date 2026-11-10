import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeMessage} from './whatsapp-routing.mjs';
const msg=(jid,text,participant='123@s.whatsapp.net')=>({key:{remoteJid:jid,participant},message:{conversation:text}});
test('ignores unknown groups even with YE trigger',()=>assert.equal(routeMessage(msg('a@g.us','YE bonjour')),null));
test('ignores untargeted group conversation',()=>assert.equal(routeMessage(msg('a@g.us','bonjour'),{allowedGroups:['a@g.us']}),null));
test('allows named group and isolates participants',()=>{const a=routeMessage(msg('a@g.us','YE aide','a@s.whatsapp.net'),{allowedGroups:['a@g.us']});const b=routeMessage(msg('a@g.us','YE aide','b@s.whatsapp.net'),{allowedGroups:['a@g.us']});assert.ok(a);assert.notEqual(a.sessionKey,b.sessionKey);});
test('ignores outgoing messages and broadcasts',()=>{assert.equal(routeMessage({...msg('a@s.whatsapp.net','bonjour'),key:{remoteJid:'a@s.whatsapp.net',fromMe:true}}),null);assert.equal(routeMessage(msg('status@broadcast','YE')),null);});
test('allows private chats',()=>assert.equal(routeMessage(msg('a@lid','INSTALLER YE')).group,false));
