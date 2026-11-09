import assert from 'node:assert/strict'
import {createNativeTimers,readableFailure} from './lib/native-timers.js'
import {createNativeTimers as oldTimers} from './test-fixtures/native-timers-v1.2.1.js'
const opaque = new Proxy(Object.create(null), {
 get(){throw Error('Native handle must not be inspected or coerced')},
 ownKeys(){throw Error('Native handle must not be serialized')}
})
assert.throws(()=>oldTimers({createSysTimer:()=>opaque,stopTimer(){}}).setTimeout(()=>{},100),
 e=>e.code==='T2' && e.message==='Timer returned object','Reproduce the physical-watch error in 1.2.1')
for(const id of [-2147483648,-1,0,2147483648,opaque]) {
 let stopped,fire
 const timers=createNativeTimers({createSysTimer:(periodic,delay,callback)=>{fire=callback;return id},stopTimer:value=>stopped=value})
 let count=0
 const logical=timers.setTimeout(()=>count++,100)
 assert.ok(logical>0);timers.clearTimeout(logical);assert.equal(stopped,id)
 fire();assert.equal(count,0,'A queued callback after cancellation must be ignored')
 const done=timers.setTimeout(()=>count++,100);fire();assert.equal(count,1)
 stopped=undefined;timers.clearTimeout(done);assert.equal(stopped,undefined,'Already-fired timer handle is released')
}
for(const api of [undefined,{}, {createSysTimer(){}}]) {
 assert.throws(()=>createNativeTimers(api).setTimeout(()=>{},1),e=>e.code==='T0')
}
assert.throws(()=>createNativeTimers({createSysTimer(){throw Error('native detail')},stopTimer(){}}).setTimeout(()=>{},1),e=>e.code==='T1' && /native detail/.test(e.message))
assert.throws(()=>createNativeTimers({createSysTimer:()=>undefined,stopTimer(){}}).setTimeout(()=>{},1),e=>e.code==='T2')
for(const invalid of [null,undefined,NaN,Infinity,-Infinity,false,true,'12',()=>{}]) {
 let fire,called=false
 const timers=createNativeTimers({createSysTimer:(periodic,delay,fn)=>{fire=fn;return invalid},
  stopTimer(){throw Error('Invalid handle must not be sent to stopTimer')}})
 assert.throws(()=>timers.setTimeout(()=>called=true,100),
  e=>e.code==='T2' && (invalid!==null || e.message==='Timer unavailable (null)'))
 fire();assert.equal(called,false,'Rejected timer cannot invoke caller later')
}
assert.match(readableFailure(Error('some different failure')),/^Start failed S0\n/)
console.log('Native timer adapter passed: reproduced 1.2.1 object failure, opaque identity, numeric handles, cancel/late callback, distinct null rejection, API/native errors.')
