import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {MotionWindow} from './page/activity.js'
import {setup,ACTIVITIES} from './test-monitor.mjs'
const source=fs.readFileSync(new URL('./page/index.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function pageEnv({granted=true,startFails=false,stopFails=false,request=null}={}) {
  const e=setup({request}), shared={monitor:null};let page,uiTimer,started=0,permissionCallback,services=[]
  class Accelerometer {setFreqMode(){}onChange(fn){this.fn=fn}offChange(){this.fn=null}start(){this.running=true}stop(){this.running=false}getCurrent(){return {x:0,y:0,z:981}}}
  vm.runInNewContext(source,{
    Page:x=>page=x,getApp:()=>({_options:{globalData:shared}}),ACTIVITIES,MotionWindow,
    Accelerometer,checkSensor:()=>true,FREQ_MODE_LOW:1,
    createWidget:(kind,options)=>({...options,setProperty(key,value){this.text=value}}),
    widget:{TEXT:1,BUTTON:2},prop:{TEXT:1},align:{CENTER_H:1},text_style:{WRAP:1},
    queryPermission:()=>[granted?2:0],requestPermission:({callback})=>{permissionCallback=callback;return 0},
    start:({file,complete_func,reload})=>{assert.equal(file,'app-service/monitor');assert.equal(reload,true);started++;if(startFails)return 7;shared.monitor=e.monitor;e.monitor.start();services=[file];complete_func({result:true});return 0},
    stop:({complete_func})=>{if(stopFails){complete_func({result:false});return 0}e.monitor.stop();services=[];complete_func({result:true});return 0},
    getAllAppServices:()=>services,
    setPageBrightTime(){},resetPageBrightTime(){},pauseDropWristScreenOff(){},resetDropWristScreenOff(){},
    Date:{now:()=>e.monitor.now()},setInterval:fn=>{uiTimer=fn;return 1},clearInterval:()=>uiTimer=null
  })
  page.build()
  return {...e,page,shared,grant:value=>permissionCallback([value]),started:()=>started,ui:()=>uiTimer?.()}
}
const e=pageEnv();e.page.toggle();await flush()
e.page.toggleActivity();assert.equal(e.monitor.activity.label,'tai_chi')
e.page.toggleMotion();const accel=e.page.accel;assert.equal(accel.running,true)
e.page.onDestroy();assert.equal(accel.running,false);assert.equal(e.monitor.running,true)
const total=e.packets.length;e.advance(5000);e.heart();e.tick();await flush()
assert.equal(e.packets.length,total+1,'Closing watch UI must not stop service samples')
assert.equal(e.packets.at(-1).context.activity.label,'tai_chi')
assert.equal(e.packets.at(-1).motion,undefined)
e.monitor.stop()
const stop=pageEnv();stop.page.toggle();await flush();stop.page.toggle();await flush()
assert.equal(stop.monitor.running,false);assert.equal(stop.shared.monitor,null);stop.page.onDestroy()
const denied=pageEnv({granted:false});denied.page.toggle();denied.grant(0)
assert.equal(denied.started(),0);assert.match(denied.page.status.text,/not granted/);denied.page.onDestroy()
const away=pageEnv({granted:false});away.page.toggle();away.page.onDestroy();away.grant(2);assert.equal(away.started(),0)
const failed=pageEnv({startFails:true});failed.page.toggle();assert.match(failed.page.status.text,/failed \(7\)/);assert.equal(failed.page.busy,false);failed.page.onDestroy()
const failedStop=pageEnv({stopFails:true});failedStop.page.toggle();await flush();failedStop.page.toggle();assert.equal(failedStop.monitor.running,false);assert.match(failedStop.page.status.text,/stop failed/);assert.match(failedStop.page.button.text,/Stop all/);failedStop.page.onDestroy()
// Practice motion must cover the whole send interval, not the last screen refresh.
const m=pageEnv();m.page.toggle();await flush();m.page.toggleMotion()
const began=m.monitor.now()/1000
for(let i=0;i<10;i++){m.advance(500);m.page.accel.fn();if(i%4===3)m.ui()}
m.tick();await flush()
let moved=m.packets.at(-1).motion
assert.equal(moved.samples,10,'Screen refreshes must not consume the motion window')
assert.equal(moved.window_start,began+0.5);assert.equal(moved.ts,began+5)
assert.equal(m.packets.at(-1).context.mode,'practice')
for(let i=0;i<10;i++){m.advance(500);m.page.accel.fn();m.ui()}
m.tick();await flush();moved=m.packets.at(-1).motion
assert.equal(moved.samples,10);assert.equal(moved.window_start,began+5.5,'Consecutive windows do not overlap')
m.advance(5000);m.tick();await flush()
assert.equal(m.packets.at(-1).motion,undefined,'No new movement means no motion, never a repeated window')
m.page.toggleMotion();assert.equal(m.monitor.motionSource,null)
m.page.accel=null;m.monitor.stop();m.page.onDestroy()
// A delayed reply must not cost the movement made while waiting for it.
const held=[];let heldCalls=0
const d=pageEnv({request:req=>{heldCalls++;held.push(JSON.parse(JSON.stringify(req.params)))
  return heldCalls===2?new Promise(resolve=>d.release=()=>resolve({ok:true,accepted_ts:req.params.ts})):Promise.resolve({ok:true,accepted_ts:req.params.ts})}})
d.page.toggle();await flush();d.page.toggleMotion()
const move=(env,n)=>{for(let i=0;i<n;i++){env.advance(500);env.page.accel.fn();if(i%4===3)env.ui()}}
move(d,10);d.tick();await flush();assert.equal(held.at(-1).motion.samples,10);assert.equal(heldCalls,2)
move(d,10);d.tick();await flush();assert.equal(heldCalls,2,'The delayed reply is still awaited')
d.release();await flush();move(d,10);d.tick();await flush()
assert.equal(heldCalls,3);assert.equal(held.at(-1).motion.samples,20,'Readings collected during a delayed reply are delivered')
assert.equal(held.at(-1).motion.window_start,held.at(-2).motion.ts+0.5)
// A reply that never arrives: the window still reaches the receiver within its 20 s limit.
const n=pageEnv({request:req=>{held.push(JSON.parse(JSON.stringify(req.params)));return held.stuck?new Promise(()=>{}):Promise.resolve({ok:true,accepted_ts:req.params.ts})}})
n.page.toggle();await flush();n.page.toggleMotion();move(n,10);held.stuck=true;n.tick();await flush();held.stuck=false
for(let i=0;i<4;i++){move(n,10);n.tick();await flush()}
let after=held.at(-1).motion;assert.equal(n.monitor.abandoned,1);assert.equal(after.samples,40)
assert.ok(after.ts-after.window_start<=20,'The receiver rejects windows longer than 20 s')
// A disconnection: readings up to the window limit are delivered on reconnect.
n.online(false);move(n,10);n.tick();await flush();move(n,10);n.tick();await flush()
const sent=held.length;n.online(true);move(n,10);n.tick();await flush()
assert.equal(held.length,sent+1);assert.equal(held.at(-1).motion.samples,30,'Readings collected while disconnected are delivered')
// A long disconnection starts a new window instead of one fake long average.
n.online(false);for(let i=0;i<6;i++){move(n,10);n.tick();await flush()}
n.online(true);move(n,10);n.tick();await flush();after=held.at(-1).motion
assert.ok(after.ts-after.window_start<=20);assert.ok(after.samples<=41)
n.page.accel=null;n.monitor.stop();n.page.onDestroy();d.page.accel=null;d.monitor.stop();d.page.onDestroy()
console.log('Page passed: screen exit preserves pulse/steps, motion stops, full-interval motion windows, delayed reply, lost reply, disconnection, explicit activity labels, denial, permission callback after exit, service failures.')

const readable=pageEnv();assert.equal(readable.page.status.text_size,26);assert.equal(readable.page.status.text_style,1);assert.ok(readable.page.status.y+readable.page.status.h<readable.page.button.y);readable.page.onDestroy()
