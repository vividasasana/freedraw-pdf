const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),cache=new Map();
class TFile{}
const timers=[];
const drawContext={save(){},restore(){},drawImage(){}};
const timerWindow={clearTimeout(){},setTimeout:fn=>{timers.push(fn);return timers.length}};
function load(relative){
 const filename=path.resolve(root,relative);if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>n==='obsidian'?{TFile,Notice:class{}}:n.startsWith('.')?load(path.resolve(path.dirname(filename),n+'.ts')):require(n),console,window:timerWindow,performance,crypto:require('crypto').webcrypto,TextEncoder,createEl:()=>({getContext:()=>drawContext})});return module.exports;
}
const ink=load('src/ink/inkEngine.ts');
const original={thinning:.5,streamline:.12,smoothing:.5,easing:'linear',taperStart:0,taperEnd:0,pressureMode:'auto'};
const changed={...original,thinning:.9,streamline:.9,smoothing:.9,easing:'ease-in',taperStart:30,taperEnd:35};
const points=Array.from({length:65},(_,i)=>({x:.1+i*.008,y:.4+Math.sin(i*.6)*.008,pressure:.3+i*.009,t:i*8}));
const render=settings=>ink.getSmoothInkStrokeOutline(points,1000,1400,5,true,false,{inkSettings:settings});
ink.setInkRenderSettings(original);const before=render(original);
ink.setInkRenderSettings(changed);
assert.deepEqual(render(original),before,'Existing stroke geometry must ignore changed global settings');
assert.notDeepEqual(render(changed),before,'New stroke must use changed settings');
assert.deepEqual(render(JSON.parse(JSON.stringify(original))),before,'Saved/reopened settings must preserve geometry');

async function main(){
 const {PDFAnnotatorSettingsController}=load('src/settings/settingsController.ts');
 let saved;
 const controller=new PDFAnnotatorSettingsController(async()=>({inkRenderSettings:original}),async value=>{saved=JSON.parse(JSON.stringify(value))},()=>{});
 await controller.load();
 await controller.updateBehaviorSettings({inkRenderSettings:changed});
 for(const fn of timers.splice(0))await fn();
 const reloaded=new PDFAnnotatorSettingsController(async()=>saved,async()=>{},()=>{});await reloaded.load();
 assert.deepEqual(JSON.parse(JSON.stringify(reloaded.getLegacyInkRenderSettings())),original,'Unopened legacy strokes must keep the pre-change baseline across restarts');
 const {AnnotationStore,createEmptyDocument}=load('src/stores/annotationStore.ts');
 const file=Object.assign(new TFile(),{path:'note.pdf',name:'note.pdf',basename:'note',stat:{size:5,ctime:1,mtime:1}});
 const doc=createEmptyDocument(file);doc.strokes=[{id:'legacy',page:1,tool:'pen',color:'#000',width:5,widthScale:.005,points,createdAt:'now'}];
 const disk=new Map([['note.pdf.annot.json',JSON.stringify(doc)]]);
 const store=new AnnotationStore({vault:{adapter:{exists:async p=>disk.has(p),read:async p=>disk.get(p),write:async(p,s)=>disk.set(p,s)}}},reloaded.getLegacyInkRenderSettings());
 const info=await store.loadWithInfo(file);
 assert.ok(info.migratedInkSettings);
 assert.deepEqual(render(info.document.strokes[0].inkSettings),before,'Legacy strokes must use the frozen baseline, not current settings');
 await store.save(file,info.document);
 const opened=await store.loadWithInfo(file);
 assert.deepEqual(render(opened.document.strokes[0].inkSettings),before);
 const {splitStrokeByEraserPath}=load('src/annotation/eraser.ts');
 const erased=splitStrokeByEraserPath(opened.document.strokes[0],[{x:.35,y:.2,pressure:.5},{x:.35,y:.6,pressure:.5}],.015,()=>Math.random().toString());
 assert.ok(erased.changed);assert.ok(erased.strokes.length>=2);
 for(const fragment of erased.strokes)assert.deepEqual(fragment.inkSettings,opened.document.strokes[0].inkSettings,'Erased fragments must inherit the stroke settings');
 const mainSource=fs.readFileSync(path.join(root,'main.ts'),'utf8');
 const syntax=ts.createSourceFile('main.ts',mainSource,ts.ScriptTarget.Latest,true);
 const sessionNode=syntax.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
 const methods=['getStrokePathSignature','getCachedStrokeOutline','drawReliablePdfStroke'].map(name=>sessionNode.members.find(m=>m.name?.getText(syntax)===name).getText(syntax)).join('\n');
 let publishedOptions;
 const context={getSmoothInkStrokeOutline:ink.getSmoothInkStrokeOutline,drawSmoothInkStroke:(...args)=>publishedOptions=args.at(-1),fillInkStrokeOutline(){}};
 vm.runInNewContext(ts.transpileModule('class Session {'+methods+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
 const session=new context.Session();session.strokePathCache=new Map();
 const surface={lastWidth:1000,lastHeight:1400},stroke=opened.document.strokes[0];
 assert.deepEqual(session.getCachedStrokeOutline(surface,stroke,5,true,false),before,'Committed canvas must use the stored settings');
 session.drawReliablePdfStroke({},surface,stroke,5,true,false,true,0);
 assert.equal(publishedOptions.inkSettings,stroke.inkSettings,'Live renderer must use the same stored settings');
 ink.drawSmoothInkStroke=(...args)=>publishedOptions=args.at(-1);
 load('src/markdown/embedRender.ts').renderAnnotationDocumentPage(drawContext,opened.document,1,1000,1400);
 assert.equal(publishedOptions.inkSettings,stroke.inkSettings,'PDF export and embeds must use stored settings');
 console.log('Stroke settings passed: old/new geometry, restart baseline, sidecar migration/reopen and erased fragments.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
