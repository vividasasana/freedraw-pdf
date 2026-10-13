const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const modules = new Map(), root = path.resolve(__dirname, '..');
class TFile {}
function load(relative) {
 const filename = path.resolve(root, relative);
 if (modules.has(filename)) return modules.get(filename).exports;
 const module = {exports: {}}; modules.set(filename, module);
 const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code, {module, exports: module.exports, console, crypto: require('node:crypto').webcrypto,
 require: name => name === 'obsidian' ? {TFile, AbstractInputSuggest:class{},Modal: class {}, Setting: class {}, Notice: class {}} : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : require(name)});
 return module.exports;
}
async function main() {
 const {AnnotationStore, createEmptyDocument} = load('src/stores/annotationStore.ts');
 const {DEFAULT_SETTINGS} = load('src/config.ts');
 const file = Object.assign(new TFile(), {path: 'paper.pdf', name: 'paper.pdf', basename: 'paper', stat: {size: 5, ctime: 1, mtime: 1}});
 const initial = createEmptyDocument(file);
 const disk = new Map([['paper.pdf.annot.json', JSON.stringify(initial, null, 2)]]);
 const app = {vault: {adapter: {exists: async p => disk.has(p), read: async p => disk.get(p), write: async (p, data) => disk.set(p, data)}}};
 const store = new AnnotationStore(app);
 const document = await store.load(file);
 document.strokes.push({id: 'pencil', page: 1, tool: 'pen', width: 4, widthScale: 4 / 1524, zIndex: 1, inkSettings: DEFAULT_SETTINGS.inkRenderSettings, color: '#000000', points: [{x: .2, y: .3, pressure: .4}], createdAt: 'now'});
 // Simulate sync preserving all annotations but reserializing JSON and metadata.
 const synced = JSON.parse(disk.get('paper.pdf.annot.json'));
 synced.updatedAt = '2030-01-01T00:00:00Z';
 synced.sourcePdf.ctime = 999;
 synced.sourcePdf.mtime = 999;
 disk.set('paper.pdf.annot.json', JSON.stringify(Object.fromEntries(Object.entries(synced).reverse())));
 document.latestPageStyle={template:'grid',paperColor:'#0000ff',pageSize:'letter'};
 await store.save(file, document);
 assert.equal(JSON.stringify((await store.load(file)).latestPageStyle),JSON.stringify(document.latestPageStyle),'Most recent page style must survive actual sidecar save/load');
 assert.equal((await store.load(file)).strokes.length, 1, 'A harmless sync rewrite must not leave visible strokes unsaved');
 const editing = await store.load(file);
 const remote = JSON.parse(disk.get('paper.pdf.annot.json'));
 remote.strokes.push({...remote.strokes[0], id: 'other-device', zIndex: 2});
 const otherData = JSON.stringify(remote);
 disk.set('paper.pdf.annot.json', otherData);
 editing.strokes.push({...editing.strokes[0], id: 'local', zIndex: 3});
 await store.save(file, editing);
 assert.equal(JSON.parse(disk.get('paper.pdf.annot.json')).strokes.length, 3, 'Independent Pencil additions must merge instead of blocking all saves');
 assert.equal(editing.strokes.length, 3, 'Merged remote ink must remain in the current document for the next save');
 await store.save(file, editing);
 const conflict = await store.load(file);
 const changed = JSON.parse(disk.get('paper.pdf.annot.json'));
 changed.strokes[0].color = '#ff0000';
 const conflictingData = JSON.stringify(changed);
 disk.set('paper.pdf.annot.json', conflictingData);
 conflict.strokes[0].color = '#00ff00';
 await assert.rejects(store.save(file, conflict), /changed in another view or device/);
 assert.equal(disk.get('paper.pdf.annot.json'), conflictingData, 'Real edits from another device must never be overwritten');
 const recovery = await store.saveRecoveryCopy(file, conflict);
 assert.equal(JSON.parse(disk.get(recovery)).strokes.length, 3, 'Local annotations must be preserved after a genuine conflict');
 console.log('Save/sync passed: formatting-only changes save/reopen; genuine conflicts preserve both versions.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
