const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
class TFile {}
const cache = new Map();
function load(name) {
 const filename = path.resolve(root, name);
 if (cache.has(filename)) return cache.get(filename).exports;
 const module = { exports: {} }; cache.set(filename, module);
 const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code, {module,exports:module.exports,require:n=>n==='obsidian'?{TFile,Notice:class {}}:n.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),n+'.ts'))):require(n),console:{warn(){},error(){}},crypto:require('crypto').webcrypto,TextEncoder,Date,Math,Map,Set,WeakMap}, {filename});
 return module.exports;
}
function deferred() { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; }
function makeFile(name) {return Object.assign(new TFile(),{path:name,name,basename:name.replace('.pdf',''),parent:{path:''},stat:{size:42,ctime:1,mtime:1}});}
async function main() {
 const {AnnotationStore,createEmptyDocument}=load('src/stores/annotationStore.ts');
 const a=makeFile('a.pdf'), b=makeFile('b.pdf');
 const disk=new Map([['a.pdf.annot.json','{ invalid']]);
 const adapter={exists:async p=>disk.has(p),read:async p=>disk.get(p),readBinary:async()=>new Uint8Array([1,2,3]).buffer,write:async(p,s)=>disk.set(p,s),remove:async p=>disk.delete(p),list:async()=>({files:[...disk.keys()]})};
 const store=new AnnotationStore({vault:{adapter}});
 await assert.rejects(()=>store.loadWithInfo(a),/annotation/i,'Unreadable annotations must never become an editable blank layer');
 assert.equal(disk.get('a.pdf.annot.json'),'{ invalid');
 disk.set('a.pdf.annot.json','{}');
 await assert.rejects(()=>store.loadWithInfo(a),/annotation/i,'Structurally invalid data must never become an editable blank layer');
 disk.clear();disk.set('b.pdf.annot.json',JSON.stringify(createEmptyDocument(b)));
 assert.equal((await store.loadWithInfo(a)).sidecarPath,null,'Byte size alone must not recover another PDF');
 await store.deleteForPdfPath('b.pdf');
 assert.ok(disk.has('b.pdf.annot.json'),'Trashing a PDF must preserve annotation recovery');
 const first=await store.loadWithInfo(b), second=await store.loadWithInfo(b);
 first.document.textItems.push({id:'one',page:1,text:'first view'});
 await store.save(b,first.document);
 second.document.textItems.push({id:'two',page:1,text:'second view'});
 await assert.rejects(()=>store.save(b,second.document),/changed|conflict/i,'A stale view must not overwrite a newer view');
 const primary=disk.get('b.pdf.annot.json');
 const recovery=await store.saveRecoveryCopy(b,second.document);
 assert.ok(JSON.parse(disk.get(recovery)).textItems.some(t=>t.id==='two'));
 assert.equal(disk.get('b.pdf.annot.json'),primary,'Recovery must not overwrite the newer primary sidecar');
 assert.equal(await store.saveRecoveryCopy(b,second.document),recovery,'Repeated failed saves should reuse an unchanged recovery');
 const undoSnapshot=JSON.parse(JSON.stringify(first.document));
 store.inheritBaseline(first.document,undoSnapshot);
 first.document.textItems.push({id:'transient',page:1,text:'later edit'});
 await store.save(b,first.document);
 await store.save(b,undoSnapshot);
 store.inheritBaseline(undoSnapshot,first.document);
 first.document.textItems=undoSnapshot.textItems;
 // Renaming while a view is open must preserve its save baseline.
 const renamed = makeFile('renamed.pdf');
 await store.migrateForRename(renamed,'b.pdf');
 first.document.textItems.push({id:'three',page:1,text:'after rename'});
 await store.save(renamed,first.document);
 assert.equal(JSON.parse(disk.get('renamed.pdf.annot.json')).textItems.length,2);
 assert.ok(disk.has('b.pdf.annot.json'));
 const indexed = Object.assign(new TFile(),{path:'renamed.pdf.annot.json'});
 const concurrentStore=new AnnotationStore({vault:{adapter,getAbstractFileByPath:()=>indexed,process:async(_file,update)=>{disk.set(indexed.path,'concurrent edit');disk.set(indexed.path,update(disk.get(indexed.path)));}}});
 const concurrent=await concurrentStore.loadWithInfo(renamed);
 await assert.rejects(()=>concurrentStore.save(renamed,concurrent.document),/changed/i);
 assert.equal(disk.get(indexed.path),'concurrent edit','Atomic update must reject an intervening write');
 const source=fs.readFileSync(path.join(root,'main.ts'),'utf8');
 const methods=source.slice(source.indexOf('\tasync attach():'),source.indexOf('\n\tdetach():'));
 const code=ts.transpileModule('class Session {'+methods+'}\nglobalThis.Session=Session;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const context={window:{clearTimeout(){}},console:{error(){}},Notice:class {},normalizeDocumentZIndexes:()=>false,normalizeDocumentStrokeScales:()=>false};
 vm.runInNewContext(code,context);
 function session(){const s=new context.Session();Object.assign(s,{file:a,annotationDocument:{strokes:['old']},isDirty:true,documentRevision:1,attachmentGeneration:0,savePromise:null,attachPromise:null,autosaveHandle:null,nextPageZIndexCache:new Map(),refreshStatus(){},bindSessionKeyListener(){},ensureUi(){},applyOverlayMode(){},invalidateAnnotationPageCache(){},getTemporarySidecarPageCount:()=>0,observePdfDom(){},bindNativePdfEvents(){},syncPages(){},refreshToolbar(){},showStartupError(){},commitActiveInkBeforeLayoutRefresh(){},finishSessionInlineTextEditor(){},closeTransientPopovers(){}});return s;}
 const s=session(), gate=deferred(), snapshots=[];
 s.store={save:async(f,d)=>{snapshots.push(JSON.stringify(d));if(snapshots.length===1)await gate.promise},getSidecarPath:f=>f.path};
 const saving=s.flushSave();s.annotationDocument.strokes.push('new');s.documentRevision++;s.isDirty=true;gate.resolve();await saving;
 assert.ok(snapshots.at(-1).includes('new'),'Save completion must include edits made during the write');
 const sw=session(), readGate=deferred(), writes=[];sw.getPdfFile=()=>b;
 sw.store={save:async(f,d)=>writes.push({path:f.path,strokes:[...d.strokes]}),loadWithInfo:async()=>readGate.promise,getSidecarPath:f=>f.path};
 const attaching=sw.attach();await sw.flushSave();readGate.resolve({document:{strokes:[]}});await attaching;
 assert.ok(writes.some(w=>w.path==='a.pdf'),'Switching must flush the old PDF');
 assert.ok(!writes.some(w=>w.path==='b.pdf'&&w.strokes.includes('old')),'Old annotations must never reach the new PDF');
 const queued=session(),attachGate=deferred();queued.attachPromise=attachGate.promise;
 queued.attachFile=()=>{throw Error('Detached session must not attach again')};
 const queuedAttach=queued.attach();queued.attachmentGeneration++;attachGate.resolve();await queuedAttach;
 const {buildPdfFromJpegPages}=load('src/export/simplePdfWriter.ts');
 const bytes=buildPdfFromJpegPages([{widthPx:1600,heightPx:2071,widthPt:612,heightPt:792,jpegBytes:new Uint8Array([255,216,255,217])}]);
 assert.match(new TextDecoder().decode(bytes),/MediaBox \[0 0 612 792\]/,'Export must retain physical page dimensions');
 console.log('V2 reliability passed: protected loads, recovery, conflicts, deferred saves/switches, physical page sizes.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
