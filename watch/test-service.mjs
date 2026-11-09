import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {Monitor} from './test-monitor.mjs'
import {readableFailure} from './lib/native-timers.js'
const source=fs.readFileSync(new URL('./app-service/monitor.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
const shared={messaging:{request:async req=>({ok:true,accepted_ts:req.params.ts})}};let service,timer
const nativeHandle=Object.freeze(Object.create(null))
class HeartRate {onCurrentChange(fn){this.callback=fn}offCurrentChange(){this.callback=null}getCurrent(){return 72}}
class Step {getCurrent(){return 100}}
vm.runInNewContext(source,{Monitor,readableFailure,HeartRate,Step,checkSensor:()=>true,connectStatus:()=>true,
 createSysTimer:(periodic,ms,fn)=>{timer=fn;return nativeHandle},stopTimer:handle=>{assert.equal(handle,nativeHandle);timer=null},
 getApp:()=>({_options:{globalData:shared}}),AppService:value=>service=value})
service.onInit();assert.equal(shared.monitor.running,true);assert.equal(typeof timer,'function')
timer();assert.equal(shared.monitor.timerTicks,1,'Native callback reaches the running service')
const old=shared.monitor;service.onDestroy();assert.equal(old.running,false);assert.equal(timer,null);assert.equal(shared.monitor,null)
console.log('App Service passed: sensor ownership, native timer, cleanup without page lifecycle dependency.')
