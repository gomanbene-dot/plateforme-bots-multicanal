import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Inbox} from './whatsapp-inbox.mjs';
test('message hors ligne conservé après redémarrage, ordre et dédoublonnage',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ye-inbox-')),'inbox.json'),now=Date.now();
 const msg=(id,age)=>({key:{id,remoteJid:'123@lid'},messageTimestamp:Math.floor((now-age)/1000),message:{conversation:'Question'}});
 let q=new Inbox(file,now);assert.ok(q.add(msg('b',60000)));assert.ok(q.add(msg('a',3600000)));
 assert.equal(q.add(msg('a',3600000)),false);assert.equal(q.add(msg('old',2*86400000)),false);
 q=new Inbox(file,now);let [id,j]=q.next();assert.equal(j.msg.key.id,'a');q.set(id,'sending');
 q=new Inbox(file,now);assert.equal(q.data.jobs[id].state,'review');assert.equal(q.next()[1].msg.key.id,'b');
 [id]=q.next();q.set(id,'done');q=new Inbox(file,now);assert.equal(q.next(),undefined);
 fs.unlinkSync(file);fs.rmdirSync(path.dirname(file));
});
