const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
let currentDevice='fixture-device';
class TFile {}
class Modal { constructor(){this.contentEl={empty(){}};} open(){this.accepted=true;this.onClose();} }
function load(name){const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,console,localStorage:{getItem:()=>currentDevice,setItem(){}},crypto:require('node:crypto').webcrypto,
 require:n=>n==='obsidian'?{TFile,AbstractInputSuggest:class{},Modal,Setting:class{},Notice:class{}}:n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n)});return module.exports;}
function harness(disk){const files=()=>[...disk].map(([p,raw])=>Object.assign(new TFile(),{path:p,name:path.posix.basename(p),basename:path.posix.basename(p).replace(/\.[^.]+$/,''),extension:p.split('.').pop(),parent:{path:path.posix.dirname(p)==='.'?'':path.posix.dirname(p)},stat:{size:typeof raw==='string'?Buffer.byteLength(raw):42,ctime:1,mtime:1}}));
 const app={vault:{configDir:'.obsidian',getFiles:files,getAbstractFileByPath:p=>files().find(f=>f.path===p),read:async f=>disk.get(f.path),process:async(f,cb)=>disk.set(f.path,cb(disk.get(f.path))),create:async(p,raw)=>{assert.ok(!disk.has(p));disk.set(p,raw);},
 adapter:{exists:async p=>disk.has(p)||[...disk.keys()].some(key=>key.startsWith(p+'/')),read:async p=>disk.get(p),write:async(p,raw)=>disk.set(p,raw),list:async folder=>({files:[...disk.keys()].filter(p=>path.posix.dirname(p)===folder||(!folder&&!p.includes('/')))}),mkdir:async()=>{},trashLocal:async p=>disk.delete(p)}},fileManager:{trashFile:async f=>disk.delete(f.path)}};return app;}
async function main(){const {AnnotationStore,createEmptyDocument}=load('src/stores/annotationStore.ts');
 // Generate immutable in-memory cases: interactive vault fixtures may have been edited.
 for(let n=1;n<=4;n++){const disk=new Map(),pdf='Four merge cases/'+n+' case.pdf';disk.set(pdf,Buffer.from('pdf'));const fixtureApp=harness(disk),base=createEmptyDocument(fixtureApp.vault.getAbstractFileByPath(pdf));
  for(let copy=0;copy<5;copy++){const stroke={id:n===3?'same-stroke':'case-'+n+'-'+copy,page:1,tool:'pen',width:5,widthScale:5/1524,color:n===3?['#111111','#222222','#333333','#444444','#555555'][copy]:'#2563eb',points:[{x:n===4? 0.1+copy*.15: 0.1,y:n===2? 0.2+copy*.01: 0.2,pressure: 0.4},{x:n===4? 0.2+copy*.15: 0.7,y:n===2? 0.4+copy*.01: 0.4,pressure: 0.4}],createdAt:'2026-10-10T12:00:00Z',zIndex:copy+1};disk.set(pdf+(copy?'.recovery-case-'+copy:'')+'.annot.json',JSON.stringify({...base,strokes:[stroke]}));}
  if(n===2){const key=[...disk.keys()].find(p=>p.includes('.recovery-case-1.annot.json'));const conflict=key.replace('.recovery-case-1.annot.json','.annot (conflict 2026-10-10 18-00-00).json');disk.set(conflict,disk.get(key));disk.delete(key);}
  const app=harness(disk),store=new AnnotationStore(app);const result=await store.combineAnnotationFiles({kind:'vault',path:''});const mainPath=[...disk.keys()].find(p=>p.endsWith('.pdf.annot.json'));
  assert.equal(JSON.parse(disk.get(mainPath)).strokes.length,n===1?1:5,'Case '+n+' must preserve distinct visible strokes and deduplicate identical copies');assert.equal(result.removed,4);console.log('Case '+n+' passed');}
 const disk=new Map([['sync.pdf',Buffer.from('pdf')]]),app=harness(disk),file=app.vault.getAbstractFileByPath('sync.pdf');const initial=createEmptyDocument(file);disk.set('sync.pdf.annot.json',JSON.stringify(initial));
 const store=new AnnotationStore(app),document=await store.load(file);document.strokes.push({id:'saved-local',page:1,tool:'pen',width:5,widthScale:5/1524,color:'#123456',points:[{x: 0.2,y: 0.3,pressure: 0.4}],createdAt:new Date().toISOString()});await store.save(file,document);
 currentDevice='other-device';disk.set('sync.pdf.annot.json',JSON.stringify(initial));const reopened=await new AnnotationStore(app).load(file);assert.equal(reopened.strokes.length,1,'Stale OneDrive overwrite must not silently lose a saved stroke after switching devices');
 disk.delete('sync.pdf.annot.json');const missing=await new AnnotationStore(app).load(file);assert.equal(missing.strokes.length,1,'Temporary OneDrive disappearance must recover saved strokes instead of starting blank');
 disk.set('sync.pdf.annot.json',JSON.stringify({...initial,updatedAt:'2099-01-01T00:00:00Z'}));assert.equal((await new AnnotationStore(app).load(file)).strokes.length,0,'A newer deliberate deletion must not be silently undone');
 const raceDisk=new Map([['race.pdf',Buffer.from('pdf')]]),raceApp=harness(raceDisk),raceFile=raceApp.vault.getAbstractFileByPath('race.pdf'),raceStore=new AnnotationStore(raceApp),raceDocument=await raceStore.load(raceFile);
 raceDocument.strokes.push({...document.strokes[0],id:'must-not-report-saved'});const write=raceApp.vault.adapter.write;raceApp.vault.adapter.write=async(p,raw)=>{await write(p,raw);if(p==='race.pdf.annot.json')raceDisk.set(p,JSON.stringify(createEmptyDocument(raceFile)));};
 await assert.rejects(raceStore.save(raceFile,raceDocument),/immediately after saving/,'A write overwritten immediately by sync must not be reported as Saved');assert.equal(raceDocument.strokes.length,1);
 console.log('OneDrive stale-write, device-switch, temporary-disappearance, newer-deletion and immediate-overwrite cases passed');}
main().catch(error=>{console.error(error);process.exitCode=1;});
