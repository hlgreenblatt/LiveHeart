import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {StepSession,snapshot} from './page/activity.js'
import {validTimerHandle,requireTimerHandle,timerFailure} from './lib/native-timers.js'
const source=fs.readFileSync(new URL('./lib/monitor.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')+'\nglobalThis.Monitor=Monitor;globalThis.ACTIVITIES=ACTIVITIES'
const module={StepSession,snapshot,validTimerHandle,requireTimerHandle,timerFailure,Date,Math,Promise}
vm.runInNewContext(source,module)
export const {Monitor,ACTIVITIES}=module
const flush=()=>new Promise(resolve=>setImmediate(resolve))
export function setup({request=null,timerId=0,timerError=null,MonitorType=Monitor,missingTimer=false,badLink=false}={}) {
  let clock=1000000, count=100, online=true, callback=null, hrCallback=null
  const packets=[]
  const heartRate={getCurrent:()=>72,onCurrentChange:fn=>hrCallback=fn,offCurrentChange:()=>hrCallback=null}
  const monitor=new MonitorType({heartRate,step:{getCurrent:()=>count},now:()=>clock,
    connected:()=>{if(badLink)throw Error('link api');return online},createTimer:missingTimer?undefined:(periodic,period,fn)=>{if(timerError)throw timerError;assert.equal(periodic,true);assert.equal(period,5000);callback=fn;return timerId},
    stopTimer:id=>{assert.equal(id,timerId);callback=null},request:request|| (async req=>{packets.push(JSON.parse(JSON.stringify(req.params)));return {ok:true,accepted_ts:req.params.ts}})})
  return {monitor,packets,advance:ms=>clock+=ms,tick:()=>callback?.(),timerCallback:()=>callback,heart:()=>hrCallback?.(),steps:n=>count=n,online:value=>online=value}
}
const e=setup();e.monitor.start();await flush()
assert.equal(e.packets[0].schema,4)
assert.equal(e.packets[0].context.mode,'background')
assert.equal(e.packets[0].context.activity,null)
assert.equal(e.packets[0].heart_rate,undefined)
e.heart();e.steps(104);e.advance(5000);e.tick();await flush()
assert.equal(e.packets.at(-1).heart_rate.bpm,72)
assert.equal(e.packets.at(-1).steps.since_start,4)
e.monitor.setActivity('tai_chi');e.steps(106);e.advance(5000);e.tick();await flush()
assert.equal(e.packets.at(-1).context.activity.source,'user')
assert.equal(e.packets.at(-1).context.activity.label,'tai_chi')
assert.equal(e.packets.at(-1).steps.since_start,0)
e.steps(2);e.advance(5000);e.tick();await flush()
assert.equal(e.packets.at(-1).steps.since_start,0,'Midnight/reset is a new baseline')
e.online(false);e.advance(30000);e.tick();await flush()
assert.equal(e.monitor.message,'Watch disconnected from phone')
const total=e.packets.length
e.online(true);e.advance(5000);e.tick();await flush()
assert.equal(e.packets.length,total+1)
assert.equal(e.packets.at(-1).heart_rate,undefined,'Expired pulse must never be re-dated')
assert.equal(e.packets.at(-1).motion,undefined)
e.advance(4*3600*1000);e.tick();await flush()
assert.equal(e.packets.at(-1).context.activity,null,'Forgotten activity labels expire')
e.monitor.stop();const stopped=e.packets.length;e.advance(5000);e.tick();e.heart();await flush()
assert.equal(e.packets.length,stopped)
assert.equal(e.monitor.heart,null)
const pending=[],p=setup({request:req=>new Promise(resolve=>pending.push(()=>resolve({ok:true,accepted_ts:req.params.ts})))})
p.monitor.start();await flush();p.monitor.stop();p.advance(5000);p.monitor.start();await flush()
const flight=p.monitor.inflight;pending[0]();await flush()
assert.equal(p.monitor.inflight,flight,'Old completion cannot release a new request')
assert.equal(p.monitor.lastAck,0)
pending[1]();await flush();assert.equal(p.monitor.inflight,null)
p.monitor.stop()
const bad=setup({request:async()=>{throw {code:4}}});bad.monitor.start();await flush()
assert.match(bad.monitor.message,/timed out/);assert.equal(bad.monitor.inflight,null);bad.monitor.stop()
console.log('Monitor passed: background timer, fresh-only reconnect, activity provenance/expiry, midnight steps, late acknowledgments, stop, timeout.')

const oldContext={StepSession,snapshot,Date,Math,Promise}
const oldSource=fs.readFileSync(new URL('./test-fixtures/monitor-v1.2.0.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')+'\nglobalThis.Monitor=Monitor'
vm.runInNewContext(oldSource,oldContext)
assert.throws(()=>setup({timerId:-2147483648,MonitorType:oldContext.Monitor}).monitor.start(),/System timer unavailable/)
for(const id of [-2147483648,-1,0,2147483648,Object.freeze(Object.create(null))]) {
 const signed=setup({timerId:id});signed.monitor.start();await flush();assert.equal(signed.packets.length,1)
 assert.equal(signed.monitor.deliveryStatus(),'Waiting for timer tick')
 const oldCallback=signed.timerCallback()
 signed.advance(5000);signed.heart();signed.tick();await flush()
 assert.equal(signed.packets.length,2);assert.equal(signed.monitor.deliveryStatus(),'Delivered 0s ago')
 signed.monitor.stop();signed.advance(5000);signed.monitor.start();await flush()
 oldCallback();await flush();assert.equal(signed.monitor.timerTicks,0,'Cancelled periodic callback cannot affect a restarted monitor')
 signed.advance(20000);assert.equal(signed.monitor.deliveryStatus(),'Timer not firing T3')
 signed.tick();await flush();assert.equal(signed.monitor.deliveryStatus(),'Delivered 0s ago')
 signed.monitor.stop()
}
const nullHandle=setup({timerId:null});let stoppedInvalid=false
nullHandle.monitor.stopTimer=()=>stoppedInvalid=true
assert.throws(()=>nullHandle.monitor.start(),e=>e.code==='T2' && e.message==='Timer unavailable (null)')
assert.equal(nullHandle.monitor.running,false);assert.equal(stoppedInvalid,false)
const missing=setup({missingTimer:true});assert.throws(()=>missing.monitor.start(),e=>e.code==='T0');assert.equal(missing.monitor.running,false)
const nativeError=setup({timerError:Error('firmware failure')});assert.throws(()=>nativeError.monitor.start(),e=>e.code==='T1' && /firmware/.test(e.message))
const badId=setup({timerId:undefined});badId.monitor.createTimer=()=>undefined;assert.throws(()=>badId.monitor.start(),e=>e.code==='T2')
const link=setup({badLink:true});assert.doesNotThrow(()=>link.monitor.start());assert.equal(link.monitor.message,'Link check failed L0');link.monitor.stop()
console.log('Repair regressions passed: opaque object/numeric handles, repeated delivery, exact cleanup, stale callbacks, timer watchdog, distinct null/API/native/link failures.')
