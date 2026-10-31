// Exercise the public export path with a real text PDF and disposable canvas/PDF.js adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PDFDocument, PDFPageTree, StandardFonts, degrees, PDFName, decodePDFRawStream } = require('pdf-lib');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
const notices = [];
global.window = { atob };
let sourceBytes, exportedBytes;
let renders = 0;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const context = new Proxy({ measureText: s => ({ width: s.length * 8 }), getLineDash: () => [] }, {
  get: (target, key) => key in target ? target[key] : () => {},
  set: (target, key, value) => { target[key] = value; return true; }
});
global.createEl = tag => { assert.equal(tag, 'canvas'); return { width: 1, height: 1, getContext: () => context,
  toDataURL: type => type === 'image/jpeg' ? 'data:image/jpeg;base64,/9j/2Q==' : png }; };
const inputFile = { path: 'fixtures/source.pdf', name: 'source.pdf', basename: 'source', parent: { path: 'fixtures' } };
const app = { vault: { adapter: { readBinary: async () => sourceBytes.slice().buffer }, getAbstractFileByPath: () => null,
  createBinary: async (filePath, bytes) => { exportedBytes = new Uint8Array(bytes); return { path: filePath, name: filePath.split('/').pop() }; } } };
Module._load = function(id, parent, isMain) {
  if (id === 'obsidian') return { Notice: class { constructor(s) { notices.push(s); } }, TFile: class {}, loadPdfJs: async () => ({
    getDocument: () => ({ promise: Promise.resolve({ numPages: 5, getPage: async n => ({
      getViewport: ({scale}) => ({ width: (n % 2 === 0 ? 400 : 300) * scale, height: (n % 2 === 0 ? 300 : 400) * scale }),
      render: () => { renders++; return { promise: Promise.resolve() }; }
    }) }), destroy: async () => {} })
  }) };
  return originalLoad.call(this, id, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);
const { exportAnnotatedMixedDocumentPdf, createNativeMixedWorkingPdf } = require('../src/export/mixedDocumentExport.ts');
const { buildPdfWithOverlays } = require('../src/export/preservedPdfWriter.ts');
function pageTextCommands(page) {
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams = typeof contents.asArray === 'function' ? contents.asArray().map(ref => page.doc.context.lookup(ref)) : [contents];
  return streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
}
(async () => {
  const input = await PDFDocument.create();
  const font = await input.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 5; n++) {
    const page = input.addPage([350, 460]);
    page.setCropBox(25, 30, 300, 400);
    page.setRotation(degrees(((n - 1) % 4) * 90));
    page.drawText(`Native selectable page ${n}`, { font, x: 45, y: 250, size: 12 });
  }
  input.setTitle('Original document');
  // Put page 4 below a nested page-tree node with inherited page attributes.
  const inheritedPage = input.getPage(3), parent = input.catalog.Pages();
  const branch = PDFPageTree.withContext(input.context);
  const branchRef = input.context.register(branch);
  branch.pushLeafNode(inheritedPage.ref);
  branch.set(PDFName.of('Parent'), input.context.getObjectRef(parent));
  parent.Kids().set(3, branchRef);
  inheritedPage.node.setParent(branchRef);
  for (const key of ['Resources','MediaBox','CropBox','Rotate']) {
    const name = PDFName.of(key), value = inheritedPage.node.get(name);
    if (value) { branch.set(name, value); inheritedPage.node.delete(name); }
  }
  sourceBytes = await input.save();
  const original = sourceBytes.slice();
  const document = { strokes: [], textItems: [], shapes: [{
    id:'overlay-line',page:1,tool:'line',color:'#ff0000',width:2,widthScale:.002,
    start:{x:.1,y:.2,pressure:.5},end:{x:.8,y:.3,pressure:.5},createdAt:'2026-10-24'
  }], appendedPages: [{
    id: 'inserted', kind: 'template', template: 'grid', paperColor: '#fffdf7', pageSize: 'letter', strokes: [], textItems: [], shapes: []
  }] };
  const entries = [3, 6, 1, 4, 2].map(pageNumber => ({ pageNumber }));
  for (const annotations of [true, false]) {
    if (annotations) assert.ok(await exportAnnotatedMixedDocumentPdf(app, inputFile, document, entries, 5), notices.join('\n'));
    else assert.ok(await createNativeMixedWorkingPdf(app, inputFile, document, entries, 5), notices.join('\n'));
    const output = await PDFDocument.load(exportedBytes);
    assert.equal(output.getPageCount(), 5);
    for (const [index, number] of [3, 6, 1, 4, 2].entries()) {
      const page = output.getPage(index);
      if (number === 6) { assert.deepEqual(page.getSize(), {width:612,height:792}); continue; }
      assert.ok(/\bBT\b/.test(pageTextCommands(page)), `Issue #8: page ${number} lost its native text commands during ${annotations ? 'annotated' : 'working'} export`);
      assert.ok(page.node.Resources().lookup(PDFName.of('Font')), 'original font resources missing');
      assert.equal(page.getRotation().angle, ((number - 1) % 4) * 90);
      assert.deepEqual(page.getCropBox(), { x: 25, y: 30, width: 300, height: 400 });
    }
    if (process.env.FREEDRAW_EXPORT_FIXTURE_DIR) {
      fs.mkdirSync(process.env.FREEDRAW_EXPORT_FIXTURE_DIR, {recursive:true});
      fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR, annotations ? 'annotated.pdf' : 'working.pdf'), exportedBytes);
    }
  }
  assert.deepEqual(sourceBytes, original, 'source PDF was modified');
  assert.equal(renders, 0, 'original PDF pages were rasterized');
  const originalLookup=app.vault.getAbstractFileByPath,originalCreate=app.vault.createBinary;
  let rootOutput;
  app.vault.getAbstractFileByPath=p=>p==='source annotated mixed.pdf'?{}:null;
  app.vault.createBinary=async(p,bytes)=>{rootOutput=p;return originalCreate(p,bytes)};
  await exportAnnotatedMixedDocumentPdf(app,{...inputFile,path:'source.pdf',parent:{path:'/'}},document,entries,5);
  assert.equal(rootOutput,'source annotated mixed 2.pdf','Root-folder exports must detect existing files with a normalised path');
  app.vault.getAbstractFileByPath=originalLookup;app.vault.createBinary=originalCreate;
  // Asymmetric transparent markers expose upside-down/swapped rotated overlays.
  const markers = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAYAAAAUufjgAAAAZElEQVR4nO3YsQ3DQADDQJr77/wBskBcxYShg3qp1nXgcMP1zf9JnMRJnMRJnMRJnMRJnMRJnMRJnMRJnE8PmJmZmZmZmZmZea/ruepzXvEPSpzESZzESZzESZzESZzESZzE+fSAXz7C7wQ5MzBtxQAAAABJRU5ErkJggg==','base64');
  const marked = await buildPdfWithOverlays(sourceBytes, [1,2,3,4], async (_number, box) => ({
    pngBytes: markers, widthPt: box.width, heightPt: box.height
  }));
  const markedDocument = await PDFDocument.load(marked.pdfBytes);
  for (const page of markedDocument.getPages()) assert.ok(page.node.Resources().lookup(PDFName.of('XObject')), 'annotation overlay missing');
  await assert.rejects(buildPdfWithOverlays(sourceBytes, [1,1], async () => ({pngBytes:null,widthPt:1,heightPt:1})), /repeated/);
  if (process.env.FREEDRAW_EXPORT_FIXTURE_DIR) fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR, 'overlay.pdf'), marked.pdfBytes);

  // Real mixed exporter: keep visible ink and still emit accepted invisible Unicode.
  const ocrModel=require('../src/ocr/model.ts');
  const handwriting={id:'ink-export',page:1,tool:'pen',color:'#6c3db5',width:3,widthScale:.003,points:[{x:.2,y:.3,pressure:.5},{x:.7,y:.4,pressure:.5}]};
  const inkDoc={strokes:[handwriting],textItems:[],shapes:[],ocrGroups:[{id:'accepted-export',page:1,strokeIds:[handwriting.id],sourceFingerprint:ocrModel.ocrFingerprint(ocrModel.ocrSourceSnapshot([handwriting])),text:'HELLO β 早安',lines:[{text:'HELLO β 早安',box:{left:.2,top:.3,right:.7,bottom:.4}}],mode:'ink',provider:'fixture',createdAt:'fixture'}]};
  const paints=[];context.fillText=text=>paints.push(text);
  for(const mode of ['ink','text']){
    inkDoc.ocrGroups[0].mode=mode;paints.length=0;const unchanged=JSON.stringify(inkDoc);
    assert.ok(await exportAnnotatedMixedDocumentPdf(app,inputFile,inkDoc,[{pageNumber:1}],5));
    const output=await PDFDocument.load(exportedBytes),commands=pageTextCommands(output.getPage(0));
    assert.match(commands,/3 Tr/,'Accepted OCR must be exported as invisible PDF text even in ink mode');
    const cmap=output.context.enumerateIndirectObjects().map(([,obj])=>{try{return obj.getContents?Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'):''}catch{return ''}}).join('\n');
    for(const character of ['β','早','安'])assert.ok(cmap.includes('<'+character.charCodeAt(0).toString(16).padStart(4,'0')+'>'),'OCR export lost Unicode mapping '+character);
    assert.equal(paints.includes('HELLO β 早安'),mode==='text','Visible OCR rendering must still follow the selected display mode');
    assert.equal(JSON.stringify(inkDoc),unchanged,'Export changed handwriting or the chosen display mode');
    if(process.env.FREEDRAW_EXPORT_FIXTURE_DIR)fs.writeFileSync(path.join(process.env.FREEDRAW_EXPORT_FIXTURE_DIR,mode+'-ocr.pdf'),exportedBytes);
  }
  inkDoc.ocrGroups[0].mode='ink';handwriting.points[0].x+=.01;
  await exportAnnotatedMixedDocumentPdf(app,inputFile,inkDoc,[{pageNumber:1}],5);
  assert.ok(!/3 Tr/.test(pageTextCommands((await PDFDocument.load(exportedBytes)).getPage(0))),'Changed handwriting must not export a stale transcript');
  console.log('Public mixed OCR export passed: ink/text visual modes, invisible Unicode, source preservation and stale-result exclusion.');


  console.log('Native PDF text export: original text/fonts, cropped and rotated pages, mixed ordering, inserted letter page, source immutability passed.');
})().finally(() => { Module._load = originalLoad; require.extensions['.ts'] = previousTs; }).catch(error => { console.error(error); process.exitCode = 1; });
