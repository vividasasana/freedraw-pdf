const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),Module=require('node:module'),vm=require('node:vm');
const old=Module._load,previous=require.extensions['.ts'];
let review=null,reviewCalls=0,opened=0,inputGate=null;
const crop={left:.1,top:.2,right:.8,bottom:.5},image='data:image/png;base64,AAAA';
class TFile{}
Module._load=function(id,parent,main){
 if(id==='obsidian')return {TFile,Modal:class{},Setting:class{},Notice:class{},AbstractInputSuggest:class{}};
 if(parent?.filename.endsWith('sessionController.ts')&&id==='./dialogs')return {openOcrOptions:()=>{opened++;return()=>{};},reviewOcrResult:async()=>{reviewCalls++;return typeof review==='function'?review():review;}};
 if(parent?.filename.endsWith('sessionController.ts')&&id==='./input')return {createOcrInput:async()=>{if(inputGate)await inputGate;return {image,box:crop};}};
 return old.call(this,id,parent,main);
};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const model=require('../src/ocr/model.ts'),{recogniseInk,parseOcrResult,ocrEndpoint}=require('../src/ocr/providers.ts'),{OcrSessionController}=require('../src/ocr/sessionController.ts');
const {AnnotationStore,createEmptyDocument}=require('../src/stores/annotationStore.ts');
const point=(x,y)=>({x,y,pressure:.5});
const stroke=id=>({id,page:1,tool:'pen',color:'#000000',width:3,widthScale:.003,points:[point(.2,.25),point(.6,.3)],createdAt:'2026-10-24'});
const disk=new Map(),file=Object.assign(new TFile(),{path:'sample.pdf',name:'sample.pdf',extension:'pdf',stat:{size:1,ctime:1,mtime:1}});
const app={vault:{adapter:{exists:async p=>p==='sample.pdf'||disk.has(p),read:async p=>disk.get(p),write:async(p,s)=>{disk.set(p,s);},list:async()=>({files:[...disk.keys()]}),readBinary:async()=>new Uint8Array([1]).buffer},getAbstractFileByPath:()=>undefined}};
async function run(){
 const raw={text:'Alpha β',lines:[{text:'Alpha β',box:{left:0,top:0,right:1,bottom:1}}]};
 const result=parseOcrResult(raw,crop);assert.deepEqual(result.lines[0].box,crop);
 assert.throws(()=>parseOcrResult({text:'bad',lines:[{text:'bad',box:{left:-1,top:0,right:1,bottom:1}}]},crop),/invalid line/);
 for(const provider of ['gemini','openai','local']){
  let request;const settings={...model.DEFAULT_OCR_SETTINGS,provider,model:'fixture',endpoint:provider==='local'?'http://127.0.0.1:8767/ocr':'https://api.openai.com/v1/chat/completions'};
  const actual=await recogniseInk(settings,provider==='local'?'':'fixture-credential',image,crop,async r=>{request=r;return {status:200,json:provider==='gemini'?{candidates:[{content:{parts:[{text:JSON.stringify(raw)}]}}]}:provider==='openai'?{choices:[{message:{content:JSON.stringify(raw)}}]}:raw};});
  assert.equal(actual.text,'Alpha β');assert.equal(request.method,'POST');assert.ok(!request.url.includes('fixture-credential'));assert.ok(request.body.includes('AAAA'));
 }
 await assert.rejects(recogniseInk(model.DEFAULT_OCR_SETTINGS,'',image,crop,async()=>{throw Error('network must not be called')}),/API key/);
 assert.throws(()=>ocrEndpoint({...model.DEFAULT_OCR_SETTINGS,provider:'local',endpoint:'file:///secret'}),/HTTPS/);
 assert.throws(()=>ocrEndpoint({...model.DEFAULT_OCR_SETTINGS,provider:'local',endpoint:'http://user:pass@localhost/ocr'}),/credentials/);
 const store=new AnnotationStore(app),loaded=await store.loadWithInfo(file),document=loaded.document;
 document.strokes=[stroke('one'),{...stroke('two'),points:[point(.2,.6),point(.8,.65)]}];
 let current=true,changes=0,calls=0;const history=[];
 const host={app,owner:{setTimeout,clearTimeout},settings:()=>({...model.DEFAULT_OCR_SETTINGS,provider:'local',endpoint:'http://localhost:8767/ocr'}),credential:()=>'',
  capture:scope=>({document,filePath:file.path,page:1,strokes:document.strokes.filter(s=>scope==='page'||s.id==='one'),aspect:1.414}),isCurrent:()=>current,
  transport:async()=>{calls++;return {status:200,json:raw};},beforeChange:()=>history.push(JSON.stringify(document)),changed:()=>changes++,notice:()=>{}};
 const controller=new OcrSessionController(host);controller.open();assert.equal(opened,1);assert.equal(calls,0,'opening OCR must never send a request');
 review={text:result.text,lines:result.lines};const originalInk=JSON.stringify(document.strokes);
 await controller.run('selection','recognise');assert.equal(calls,1);assert.equal(reviewCalls,1);assert.equal(document.ocrGroups.length,1);assert.deepEqual(document.ocrGroups[0].strokeIds,['one']);
 assert.deepEqual([...model.getOcrPageView(document,1).hiddenStrokeIds],['one']);assert.equal(JSON.stringify(document.strokes),originalInk);
 await controller.run('selection','ink');assert.equal(model.getOcrPageView(document,1).groups.length,0);await controller.run('selection','text');assert.equal(model.getOcrPageView(document,1).groups.length,1);
 assert.equal(history.length,3);assert.equal(changes,3);
 // Real sidecar save/load retains the group, original strokes and safe defaults.
 await store.save(file,document);const reopened=(await new AnnotationStore(app).loadWithInfo(file)).document;
 assert.equal(reopened.ocrGroups[0].text,'Alpha β');assert.equal(reopened.strokes.length,2);assert.equal(model.getOcrPageView(reopened,1).groups.length,1,JSON.stringify([document.strokes[0],reopened.strokes[0]]));
 reopened.strokes[0].points[0].x+=.01;assert.equal(model.getOcrPageView(reopened,1).groups.length,0,'changed source must automatically show original ink');
 // Paste mode is a working offline/manual route, without an OCR request.
 const priorCalls=calls;review={text:'Pasted text',lines:[{text:'Pasted text',box:crop}]};await controller.run('page','paste');assert.equal(calls,priorCalls);assert.equal(document.ocrGroups[0].provider,'Pasted transcript');assert.equal(document.ocrGroups[0].strokeIds.length,2);
 // Actual session rendering/toolbar/input seams: hidden ink stays in source data,
 // and native text selection never enters a drawing handler.
 const mainSource=fs.readFileSync(path.resolve(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',mainSource,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
 const names=['getPageAnnotationBucket','appendOcrControls','isPointerTargetInsidePdfPage','handleDocumentPointerDown','handleViewPointerDown','handleDocumentTouchStart'];
 const code='class Session{'+names.map(name=>cls.members.find(m=>m.name?.getText(tree)===name).getText(tree)).join('\n')+'}globalThis.Session=Session;';
 const context={getOcrPageView:model.getOcrPageView,isDomElement:()=>true};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
 const session=new context.Session(),activations=[];Object.assign(session,{annotationDocument:document,annotationPageCache:null,ocrHiddenStrokeIds:new Set(),currentPage:1,createOcrButton:()=>({label:'OCR'}),createIconButton:(_icon,label,_active,click)=>({label,click}),getOcrController:()=>({run:(...args)=>activations.push(args)})});
 const bucket=session.getPageAnnotationBucket(1);assert.equal(bucket.strokes.length,0);assert.equal(document.strokes.length,2,'projection must not remove original handwriting');
 const group={children:[],appendChild(n){this.children.push(n);}};session.appendOcrControls(group);assert.equal(group.children[1].label,'Show original handwriting');group.children[1].click();assert.deepEqual(activations,[['page','ink']]);
 const target={closest:()=>({})};assert.equal(session.isPointerTargetInsidePdfPage(target),false);session.handleDocumentPointerDown({target});session.handleViewPointerDown({target});session.handleDocumentTouchStart({target});
 // Exact stale-result and cancelled job guards.
 const acceptedBefore=JSON.stringify(document.ocrGroups);let release;inputGate=new Promise(r=>release=r);const pending=controller.run('page','recognise');document.strokes[0].points[0].y+=.01;release();await pending;assert.equal(JSON.stringify(document.ocrGroups),acceptedBefore);
 inputGate=new Promise(r=>release=r);const cancelled=controller.run('page','recognise');controller.cancel();release();await cancelled;assert.equal(JSON.stringify(document.ocrGroups),acceptedBefore);
 inputGate=null;review=()=>{document.strokes[0].points[0].x+=.01;return {text:'stale after review',lines:result.lines};};await controller.run('page','recognise');assert.equal(JSON.stringify(document.ocrGroups),acceptedBefore);
 assert.deepEqual(model.normalizeOcrGroups([{...document.ocrGroups[0],lines:[{text:'x',box:{left:0,top:0,right:NaN,bottom:1}}]}]),[]);
 console.log('OCR workflow passed: three request adapters, explicit send, scope, review, paste, reversible display, original ink, sidecar reload, stale/cancel guards and validation.');
}
run().finally(()=>{Module._load=old;require.extensions['.ts']=previous;}).catch(e=>{console.error(e);process.exitCode=1;});
