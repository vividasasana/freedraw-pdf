const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),{loadSource}=require('./load-source');
const model=loadSource('src/ocr/model.ts'),transforms=loadSource('src/ocr/transforms.ts'),interaction=loadSource('src/annotation/interaction.ts');
const source=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession'),pluginClass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='PDFAnnotatorPlugin');
let serial=0;const ctx={...transforms,...interaction,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),cloneDocument:d=>JSON.parse(JSON.stringify(d)),generateId:prefix=>prefix+'-'+ ++serial};
const names=['moveSelectedTarget','moveSelectedTargetsWithinPage','resizeSelectedTargets','scaleTargetWithinBounds','copySelectedTargets','cutSelectedTargets','pasteClipboard','duplicateSelectedTargets','deleteSelectedTargets'];
const code='class Session{'+names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n')+'}class Clipboard{'+['getClipboard','setClipboard'].map(name=>pluginClass.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n')+'}globalThis.Session=Session;globalThis.Clipboard=Clipboard;';
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
function fixture(){
 const strokes=[1,2].map((id,i)=>({id:'source-'+id,page:1,tool:'pen',color:'#000000',width:3,points:[{x:.2+i*.1,y:.2,pressure:.5},{x:.4+i*.1,y:.4,pressure:.5}]}));
 const doc={version:4,sourceFile:'source.pdf',strokes,textItems:[],shapes:[],ocrGroups:[{id:'source-group',page:1,strokeIds:strokes.map(s=>s.id),sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot(strokes)),text:'Hello',lines:[{text:'Hello',box:{left:.2,top:.2,right:.5,bottom:.4}}],mode:'text',provider:'Fixture',createdAt:'fixture'}]};
 const plugin=new ctx.Clipboard();plugin.sessions=new Map();
 const s=new ctx.Session();Object.assign(s,{annotationDocument:doc,selectedTargets:strokes.map(s=>({kind:'stroke',id:s.id,page:1})),plugin,currentPage:1,undoStack:[],
  getRecentPdfPastePoint:()=>null,getNextPageZIndex:()=>++serial,pushHistory(){this.undoStack.push(JSON.parse(JSON.stringify(this.annotationDocument)))},markDirtyAndRedraw(){},refreshToolbar(){},refreshStatus(){},isCornerResizeHandle:()=>true,
  getCombinedBounds(targets){const ids=new Set(targets.map(t=>t.id)),p=this.annotationDocument.strokes.filter(s=>ids.has(s.id)).flatMap(s=>s.points);return {left:Math.min(...p.map(p=>p.x)),top:Math.min(...p.map(p=>p.y)),right:Math.max(...p.map(p=>p.x)),bottom:Math.max(...p.map(p=>p.y))}}});
 return s;
}
const view=s=>model.getOcrPageView(s.annotationDocument,s.currentPage);
{
 const s=fixture();s.moveSelectedTargetsWithinPage(s.selectedTargets,.1,.1);assert.equal(view(s).groups.length,1);assert.ok(Math.abs(view(s).groups[0].lines[0].box.left-.3)<1e-8);
 s.resizeSelectedTargets(s.selectedTargets,'se',.12,.08);assert.equal(view(s).groups.length,1);assert.ok(view(s).groups[0].lines[0].box.right>.6);
 const saved=JSON.parse(JSON.stringify(s.annotationDocument));assert.equal(model.getOcrPageView(saved,1).groups.length,1,'Moved/resized OCR must survive reload');
 s.annotationDocument.strokes[0].points[0].x+=.01;assert.equal(view(s).groups.length,0,'Editing ink must still invalidate stale recognition');
}
{
 const s=fixture();s.copySelectedTargets();assert.equal(s.plugin.getClipboard().ocrGroups.length,1);
 const originalFingerprint=s.annotationDocument.ocrGroups[0].sourceFingerprint;
 s.currentPage=2;s.pasteClipboard();assert.equal(view(s).groups.length,1);assert.ok(view(s).groups[0].strokeIds.every(id=>!id.startsWith('source-')));
 assert.equal(s.annotationDocument.ocrGroups[0].sourceFingerprint,originalFingerprint);assert.equal(model.getOcrPageView(s.annotationDocument,1).groups.length,1);
 const target=fixture();target.annotationDocument={version:4,sourceFile:'other.pdf',strokes:[],shapes:[],textItems:[]};target.plugin=s.plugin;target.currentPage=3;target.pasteClipboard(true);assert.equal(view(target).groups.length,1,'Cross-PDF paste must retain recognition');
}
{
 const s=fixture();s.duplicateSelectedTargets();assert.equal(view(s).groups.length,2);assert.equal(s.annotationDocument.strokes.length,4);assert.equal(s.undoStack.length,1);
 s.annotationDocument=s.undoStack[0];assert.equal(view(s).groups.length,1,'Undo duplicate must restore the original OCR group');
}
{
 const s=fixture();s.cutSelectedTargets();assert.equal(s.annotationDocument.strokes.length,0);s.currentPage=2;s.pasteClipboard(true);assert.equal(view(s).groups.length,1,'Cut/paste must carry recognition');
}
{
 const s=fixture();s.selectedTargets=s.selectedTargets.slice(0,1);s.copySelectedTargets();assert.equal(s.plugin.getClipboard().ocrGroups.length,0,'Do not attach a full transcript to a partial word');
 s.duplicateSelectedTargets();assert.equal(s.annotationDocument.ocrGroups.length,1);
}
{const s=fixture();s.selectedTargets=s.selectedTargets.slice(0,1);s.deleteSelectedTargets();assert.equal(s.annotationDocument.ocrGroups.length,0,'Deleting recognised ink must remove its stored transcript');s.annotationDocument=s.undoStack[0];assert.equal(view(s).groups.length,1,'Undo delete must restore ink and text together');}
console.log('OCR transforms passed: real session move/resize, copy/cut/paste, cross-PDF/new page, duplicate/undo, reload, fresh source IDs and stale/partial safeguards.');
