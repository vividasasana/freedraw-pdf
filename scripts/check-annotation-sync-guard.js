const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const file=path.join(__dirname,'../annotation-sync-guard/model.ts'),moduleStub={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:moduleStub,exports:moduleStub.exports,require,Set,Math});
const {summarizeAnnotations,missingAnnotationIds,guardFileKey}=moduleStub.exports;
const original={sourceFile:'paper.pdf',strokes:[{id:'a'},{id:'b'}],textItems:[{id:'box'}],shapes:[],imageItems:[],updatedAt:'2026-10-10'};
const before=summarizeAnnotations(JSON.stringify(original));
assert.deepEqual(Array.from(missingAnnotationIds(before,summarizeAnnotations(JSON.stringify({...original,strokes:[{id:'a'}]})))),['stroke:b']);
assert.equal(missingAnnotationIds(before,summarizeAnnotations(JSON.stringify({...original,strokes:[{id:'a'}],removedPages:[{annotations:{strokes:[{id:'b'}]}}]}))).length,0,'Moving an annotation into Removed pages is not data loss');
assert.throws(()=>summarizeAnnotations('{bad'));
assert.notEqual(guardFileKey('a.pdf.annot.json'),guardFileKey('b.pdf.annot.json'));
async function integration(){
 const fakeModule={exports:{}};class TFile{};class Plugin{async saveData(){} }class Notice{}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../annotation-sync-guard/main.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module:fakeModule,exports:fakeModule.exports,require:n=>n==='obsidian'?{TFile,Plugin,Notice,PluginSettingTab:class{},App:class{},Modal:class{},Setting:class{},normalizePath:s=>s}:moduleStub.exports,console,Map,Set,Promise,Date,Math});
 const Guard=fakeModule.exports.default,guard=new Guard(),disk=new Map([['paper.pdf', 'pdf'],['paper.pdf.annot.json',JSON.stringify(original)]]);
 guard.app={vault:{adapter:{exists:async p=>disk.has(p),read:async p=>disk.get(p),write:async(p,raw)=>disk.set(p,raw)}}};guard.root='backups';guard.status={setText(){},setAttribute(){}};
 await guard.inspect('paper.pdf.annot.json');const latest=guard.snapshotPath('paper.pdf.annot.json','latest'),saved=disk.get(latest);
 disk.set('paper.pdf.annot.json',JSON.stringify({...original,strokes:[{id:'a'}]}));await guard.inspect('paper.pdf.annot.json');assert.equal(disk.get(latest),saved,'Actual monitor must preserve good backup after lost strokes');assert.ok(guard.state.alerts['paper.pdf.annot.json']);
 disk.delete('paper.pdf.annot.json');await guard.observeDeletion('paper.pdf.annot.json');assert.ok(guard.state.events.some(e=>e.event==='deleted'),'JSON deletion path must be recorded');assert.equal(disk.get(latest),saved);
 console.log('Annotation Sync Guard passed: actual monitor preserves good backup and records JSON deletion; model distinguishes removed pages');
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
