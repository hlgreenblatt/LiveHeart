import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {createNativeTimers} from './lib/native-timers.js'
const timers=new Map();let next=0,online=true
const ble={addListener(){},connectStatus:()=>online,send:()=>true}
const logger={info(){},error(){},warn(){},log(){}}
const source=fs.readFileSync(new URL('./lib/zml-app.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export{l as BaseApp};','globalThis.Transport=F;')
const context={Buffer,Promise,console,createNativeTimers,__$$R$$__:name=>({
  '@zos/utils':{EventBus:EventEmitter,log:{getLogger:()=>logger}},
  '@zos/ble':ble,'@zos/timer':{createSysTimer:(periodic,ms,callback)=>{assert.equal(periodic,false);const id=Object.freeze({opaque:next++});timers.set(id,{ms,callback});return id},stopTimer:id=>{assert.ok(timers.has(id),'Original native object must reach stopTimer');timers.delete(id)}},
  '@zos/app':{},'@zos/device':{},'@zos/i18n':{},'@zos/router':{}
}[name])}
vm.runInNewContext(source,context)
const transport=new context.Transport({appId:9104177,ble})
transport.waitingShakePromise=Promise.resolve();transport.appSidePort=1
const flush=()=>new Promise(resolve=>setImmediate(resolve))
let pending=transport.request({hello:'test'},{timeout:12000});await flush()
assert.equal(transport.handlers.size,1)
const id=[...transport.handlers.keys()][0]
transport.onResponse({traceId:id,dataType:2,payload:Buffer.from('{"ok":true}')})
assert.equal((await pending).ok,true);assert.equal(transport.handlers.size,0);assert.equal(timers.size,0)
assert.doesNotThrow(()=>transport.onResponse({traceId:id,dataType:2,payload:Buffer.from('{}')}),'Late response must be ignored')
pending=transport.request({hello:'test'},{timeout:12000});const rejection=assert.rejects(pending,e=>e.code===4);await flush()
const timer=[...timers.entries()][0];assert.equal(timer[1].ms,12000);timers.delete(timer[0]);timer[1].callback();await rejection
assert.equal(transport.handlers.size,0)
pending=transport.request({hello:'test'},{timeout:12000});const disconnect=assert.rejects(pending,e=>e.code===2);await flush();online=false;transport.emit('bleStatusChanged',false);await disconnect
assert.equal(transport.handlers.size,0);assert.equal(timers.size,0)
console.log('Actual vendored transport passed: native timers, acknowledgement cleanup, late response, timeout, disconnect cleanup.')
