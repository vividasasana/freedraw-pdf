const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),Module=require('node:module');
const originalLoad=Module._load,originalTs=require.extensions['.ts'];
let review=initial=>({text:initial.text,lines:initial.lines});
const openOptions=new WeakSet();
Module._load=function(id,parent,main){
 if(parent?.filename.endsWith('sessionController.ts')&&id==='./dialogs')return {openOcrOptions:app=>{openOptions.add(app);return()=>openOptions.delete(app)},reviewOcrResult:async(_app,initial)=>review(initial)};
 if(parent?.filename.endsWith('sessionController.ts')&&id==='./input')return {createOcrInput:async()=>({image:'data:image/png;base64,AAAA',box:{left:0,top:0,right:1,bottom:1}})};
 return originalLoad.call(this,id,parent,main);
};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {OcrSessionController}=require('../src/ocr/sessionController.ts');
const text={text:'Fixture',lines:[{text:'Fixture',box:{left:0,top:0,right:1,bottom:1}}]};
function fixture(transport,owner={setTimeout,clearTimeout}){
 const document={strokes:[1,2,3].map(page=>({id:'stroke-'+page,page,tool:'pen',color:'#000000',width:3,points:[{x:.1,y:.1,pressure:.5},{x:.5,y:.2,pressure:.5}]}))};
 const capture=page=>({document,filePath:'fixture.pdf',page,strokes:document.strokes.filter(stroke=>stroke.page===page),aspect:1.414});
 const notices=[],app={};let changes=0,history=0,state,controller;
 controller=new OcrSessionController({app,owner,capture:()=>capture(1),capturePages:()=>[1,2,3].map(capture),isCurrent:()=>true,
  settings:()=>({provider:'local',model:'fixture',endpoint:'http://127.0.0.1:8767/ocr',language:'English',showToolbarButton:true}),credential:()=>'',transport,
  beforeChange:()=>history++,changed:()=>changes++,notice:value=>notices.push(value),stateChanged:()=>state={...controller.state}});
 return {controller,document,notices,get optionsOpen(){return openOptions.has(app)},get state(){return state},get changes(){return changes},get history(){return history}};
}
const tick=()=>new Promise(setImmediate);
async function run(){
 const success=fixture(async()=>({status:200,json:text}));success.controller.open();assert.equal(success.optionsOpen,true);
 await success.controller.run('page','recognise');assert.equal(success.state.completed,1);assert.equal(success.optionsOpen,false,'Accepted OCR must return to the PDF without reopening options');success.controller.dispose();
 const keepInk=fixture(async()=>({status:200,json:text}));const settings=keepInk.controller.host.settings;keepInk.controller.host.settings=()=>({...settings(),copyHandwritingAsText:true});const kept=JSON.stringify(keepInk.document.strokes);
 await keepInk.controller.run('page','recognise');assert.equal(keepInk.document.ocrGroups[0].mode,'ink','The opt-in keeps reviewed handwriting visible');assert.equal(JSON.stringify(keepInk.document.strokes),kept);assert.equal(keepInk.document.ocrGroups[0].text,text.text);keepInk.controller.dispose();
 const allAccepted=fixture(async()=>({status:200,json:text}));allAccepted.controller.open();
 await allAccepted.controller.run('document','recognise');assert.equal(allAccepted.state.completed,3);assert.equal(allAccepted.optionsOpen,false,'A fully accepted batch returns to the PDF');allAccepted.controller.dispose();
 let requests=0;const batch=fixture(async()=>({status:200,json:++requests===2?{}:text}));
 const originalInk=JSON.stringify(batch.document.strokes);
 await batch.controller.run('document','recognise');
 assert.equal(requests,3);assert.equal(batch.document.ocrGroups.length,2);assert.equal(batch.state.completed,2);assert.equal(batch.state.failed,1);
 assert.equal(batch.optionsOpen,true,'Keep partial failures visible for retry');
 await batch.controller.run('document','retry');
 assert.equal(requests,4,'Retry must send only the failed page');assert.equal(batch.document.ocrGroups.length,3);
 assert.equal(batch.optionsOpen,false,'A successful retry closes the options');
 await batch.controller.run('document','ink');assert.ok(batch.document.ocrGroups.every(group=>group.mode==='ink'));
 await batch.controller.run('document','text');assert.ok(batch.document.ocrGroups.every(group=>group.mode==='text'));
 assert.equal(JSON.stringify(batch.document.strokes),originalInk);batch.controller.dispose();

 requests=0;let unavailable=true;const account=fixture(async()=>{requests++;return {status:unavailable?404:200,json:text};});
 await account.controller.run('document','recognise');
 assert.equal(requests,1,'An unavailable model must stop the batch after one request');assert.equal(account.state.failed,3);assert.match(account.state.message,/404/);
 unavailable=false;await account.controller.run('document','retry');assert.equal(requests,4);assert.equal(account.document.ocrGroups.length,3);account.controller.dispose();

 const fastRetries={setTimeout:(fn,ms)=>setTimeout(fn,ms===90000?90000:0),clearTimeout};
 requests=0;const transient=fixture(async()=>({status:++requests<3?503:200,json:text}),fastRetries);
 await transient.controller.run('page','recognise');assert.equal(requests,3);assert.equal(transient.document.ocrGroups.length,1);transient.controller.dispose();
 requests=0;const exhausted=fixture(async()=>{requests++;return {status:503,json:{}}},fastRetries);
 await exhausted.controller.run('document','recognise');assert.equal(requests,3,'Stop after two retries, without flooding other pages');assert.equal(exhausted.state.failed,3);assert.match(exhausted.state.message,/503/);assert.equal(exhausted.document.ocrGroups,undefined);exhausted.controller.dispose();

 requests=0;let backoff;
 const retryCancelled=fixture(async()=>{requests++;return {status:503,json:{}}},{setTimeout:(fn,ms)=>ms===90000?setTimeout(fn,ms):(backoff=fn,0),clearTimeout});
 const retryWaiting=retryCancelled.controller.run('page','recognise');await tick();assert.equal(requests,1);retryCancelled.controller.cancel();backoff();await retryWaiting;await tick();assert.equal(requests,1,'Cancelling during backoff must not send another request');retryCancelled.controller.dispose();

 let release;const busy=fixture(()=>new Promise(resolve=>release=()=>resolve({status:200,json:text})));
 const pending=busy.controller.run('page','recognise');await tick();
 assert.equal(busy.controller.isBusy,true);await busy.controller.run('page','text');assert.equal(busy.controller.isBusy,true,'Display must not invalidate an in-flight job');
 release();await pending;assert.equal(busy.document.ocrGroups.length,1);assert.ok(busy.notices.some(message=>/still running/.test(message)));busy.controller.dispose();

 const cancelled=fixture(()=>new Promise(()=>{}));const waiting=cancelled.controller.run('page','recognise');await tick();cancelled.controller.cancel();await waiting;
 assert.equal(cancelled.controller.isBusy,false);assert.equal(cancelled.document.ocrGroups,undefined);assert.equal(cancelled.state.stage,'cancelled');cancelled.controller.dispose();

 const timed=fixture(()=>new Promise(()=>{}),{setTimeout:fn=>setTimeout(fn,5),clearTimeout});
 await timed.controller.run('page','recognise');assert.equal(timed.state.stage,'failed');assert.match(timed.state.message,/90 seconds/);assert.equal(timed.controller.isBusy,false);timed.controller.dispose();

 let reviews=0;review=initial=>++reviews===2?null:{text:initial.text,lines:initial.lines};const skipped=fixture(async()=>({status:200,json:text}));
 await skipped.controller.run('document','recognise');assert.equal(skipped.state.completed,2);assert.equal(skipped.state.skipped,1);assert.equal(skipped.document.ocrGroups.length,2);assert.equal(skipped.optionsOpen,false,'An intentional skip does not leave a completed job open');skipped.controller.dispose();
 review=()=>null;const allSkipped=fixture(async()=>({status:200,json:text}));allSkipped.controller.open();
 await allSkipped.controller.run('page','recognise');assert.equal(allSkipped.state.completed,0);assert.equal(allSkipped.state.skipped,1);assert.equal(allSkipped.optionsOpen,true,'Keep options available when no result was accepted');assert.equal(allSkipped.document.ocrGroups,undefined);allSkipped.controller.dispose();
 console.log('OCR jobs passed: whole-PDF progress, partial success, retry failed pages, account errors stop requests, skip review, busy display guard, cancellation, timeout and original ink preservation.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Module._load=originalLoad;require.extensions['.ts']=originalTs;});
