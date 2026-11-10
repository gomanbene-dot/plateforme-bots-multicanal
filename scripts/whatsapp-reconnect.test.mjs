import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReconnect} from './whatsapp-reconnect.mjs';
test('retries beyond five failures, bounds delay and avoids duplicate timers',async()=>{
 const tasks=[];let calls=0;
 const r=createReconnect({run:async()=>{calls++;throw Error('offline');},onError:()=>{},schedule:(fn,delay)=>{tasks.push({fn,delay});return tasks.length;}});
 r.retry();r.retry();assert.equal(tasks.length,1);
 for(let i=0;i<12;i++)await tasks[i].fn();
 assert.equal(calls,12);assert.ok(tasks.every(t=>t.delay<=300000));
 r.stop();await tasks.at(-1).fn();assert.equal(calls,12);
});
