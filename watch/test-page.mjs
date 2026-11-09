import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {MotionWindow} from './page/activity.js'
import {setup,ACTIVITIES} from './test-monitor.mjs'
const source=fs.readFileSync(new URL('./page/index.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function pageEnv({granted=true,startFails=false,stopFails=false}={}) {
  const e=setup(), shared={monitor:null};let page,uiTimer,started=0,permissionCallback,services=[]
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
    Date:{now:()=>1000000},setInterval:fn=>{uiTimer=fn;return 1},clearInterval:()=>uiTimer=null
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
console.log('Page passed: screen exit preserves pulse/steps, motion stops, explicit activity labels, denial, permission callback after exit, service failures.')

const readable=pageEnv();assert.equal(readable.page.status.text_size,26);assert.equal(readable.page.status.text_style,1);assert.ok(readable.page.status.y+readable.page.status.h<readable.page.button.y);readable.page.onDestroy()
