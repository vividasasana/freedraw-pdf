const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),Module=require('node:module'),vm=require('node:vm');
const previous=Module._load,previousTs=require.extensions['.ts'];class TFile{}
Module._load=function(id,parent,main){if(id==='obsidian')return {TFile,Modal:class{},Setting:class{},Notice:class{},AbstractInputSuggest:class{}};return previous.call(this,id,parent,main)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
(async()=>{
 const life=require('../src/notebook/pageLifecycle.ts'),model=require('../src/ocr/model.ts'),{AnnotationStore,createEmptyDocument}=require('../src/stores/annotationStore.ts');
 const file=Object.assign(new TFile(),{path:'qa.pdf',name:'qa.pdf',basename:'qa',stat:{size:1,ctime:1,mtime:1}}),disk=new Map(),app={vault:{adapter:{exists:async p=>p==='qa.pdf'||disk.has(p),read:async p=>disk.get(p),write:async(p,s)=>disk.set(p,s),list:async()=>({files:[...disk.keys()]})},getAbstractFileByPath:()=>undefined}};
 const page=id=>({id,title:id,kind:'template',template:'ruled',paperColor:'#ffffff',pageSize:'a4',strokes:[],textItems:[],shapes:[]}),stroke=(id,page)=>({id,page,tool:'pen',color:'#55b4ff',width:3,widthScale:.003,points:[{x:.2,y:.2,pressure:.5},{x:.5,y:.3,pressure:.5}],createdAt:'2026-10-27'});
 const doc=createEmptyDocument(file);doc.appendedPages=[page('a'),page('b')];doc.strokes=[stroke('a-ink',3),stroke('b-ink',4)];doc.ocrGroups=doc.strokes.map(s=>({id:s.id+'-ocr',page:s.page,strokeIds:[s.id],sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot([s])),text:s.id,lines:[{text:s.id,box:{left:.2,top:.2,right:.5,bottom:.3}}],mode:'text',provider:'fixture',createdAt:'2026-10-27'}));
 const valid=document=>{for(const g of document.ocrGroups??[]){assert.equal(document.strokes.find(s=>s.id===g.strokeIds[0])?.page,g.page,'OCR metadata must follow its source page');assert.equal(model.getOcrPageView(document,g.page).groups.some(x=>x.id===g.id),true,'Accepted text must remain usable after page operations')}};
 life.insertSyntheticPage(doc,2,0,page('inserted'));valid(doc);
 const removed=life.removeSyntheticPageToTrash(doc,2,1);assert.equal(removed.annotations.ocrGroups?.length,1,'Removed pages must retain their accepted transcript');valid(doc);assert.equal(doc.ocrGroups.length,1);
 const store=new AnnotationStore(app);await store.save(file,doc);const reopened=(await new AnnotationStore(app).loadWithInfo(file)).document;assert.equal(reopened.removedPages[0].annotations.ocrGroups?.length,1,'Removed OCR must survive save/reload');
 life.restoreSyntheticPageFromTrash(reopened,2,'a');valid(reopened);assert.equal(reopened.ocrGroups.length,2);
 for(let i=0;i<30;i++){const index=i%reopened.appendedPages.length;const deleted=life.removeSyntheticPageToTrash(reopened,2,index);valid(reopened);life.restoreSyntheticPageFromTrash(reopened,2,deleted.page.id);valid(reopened)}

 // Exercise the actual session methods, not a second implementation of page commands.
 const source=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
 const transforms=require('../src/ocr/transforms.ts'),interaction=require('../src/annotation/interaction.ts');
 let serial=0,saved;
 const ctx={...life,...transforms,...interaction,cloneDocument:d=>JSON.parse(JSON.stringify(d)),generateId:p=>p+'-qa-'+ ++serial,Notice:class{},
 createNativeMixedWorkingPdf:async()=>({file:{path:'working.pdf',name:'working.pdf'},pageMap:new Map([[3,2],[4,1]])})};
 const names=['duplicateCurrentTemplatePage','clearCurrentTemplatePageContents','createNativeWorkingPdfFromDocument'];
 vm.runInNewContext(ts.transpileModule('class Session{'+names.map(name=>cls.members.find(n=>n.name?.getText(tree)===name).getText(tree)).join('\n')+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
 const ordered=reopened.strokes.find(s=>s.page===4);ordered.zIndex=9;const reverse=JSON.parse(JSON.stringify(ordered));reverse.id='reverse-z';reverse.zIndex=1;reverse.points=reverse.points.map(p=>({...p,x:p.x+.1}));reopened.strokes.push(reverse);reopened.ocrGroups.push({...reopened.ocrGroups.find(g=>g.page===4),id:'reverse-ocr',strokeIds:[reverse.id],text:'Different passage',sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot([reverse]))});
 const s=new ctx.Session();Object.assign(s,{file,annotationDocument:JSON.parse(JSON.stringify(reopened)),realPdfPageCount:2,currentPage:4,
 finishSessionInlineTextEditor(){},getSyntheticPageIndex(){return this.currentPage-this.realPdfPageCount-1},getAppendedPages(){return this.annotationDocument.appendedPages},
 pushHistory(){},markDirtyAndRedraw(){},refreshSyntheticPages(){},getNextPageZIndex:()=>1,refreshStatus(){},requestDangerConfirmation:(a,b,c,fn)=>fn(),
 store:{save:async(file,doc)=>saved=doc},plugin:{app,openPdfFileAtPage:async()=>{}}});
 const sourceCount=s.annotationDocument.ocrGroups.length;
 s.duplicateCurrentTemplatePage();valid(s.annotationDocument);assert.equal(s.annotationDocument.ocrGroups.length,sourceCount+2,'Page duplicate must carry valid OCR');
 for(const source of reopened.ocrGroups.filter(g=>g.page===4)){const target=s.annotationDocument.ocrGroups.find(g=>g.page===s.currentPage&&g.text===source.text);assert.deepEqual(JSON.parse(JSON.stringify(s.annotationDocument.strokes.find(st=>st.id===target.strokeIds[0]).points)),reopened.strokes.find(st=>st.id===source.strokeIds[0]).points,'Page duplicate must associate each transcript with its own handwriting despite stacking order');}
 const copied=s.annotationDocument.ocrGroups.find(g=>g.page===s.currentPage);assert.ok(copied.strokeIds.every(id=>!reopened.strokes.some(stroke=>stroke.id===id)),'Copied group must use copied ink IDs');
 s.duplicateCurrentTemplatePage(false);valid(s.annotationDocument);assert.equal(s.annotationDocument.ocrGroups.length,sourceCount+2,'Structure-only copy must not carry OCR');
 s.currentPage--;s.clearCurrentTemplatePageContents();valid(s.annotationDocument);assert.equal(s.annotationDocument.ocrGroups.length,sourceCount,'Clearing ink must remove its transcript');
 const remapped=JSON.parse(JSON.stringify(reopened));await s.createNativeWorkingPdfFromDocument(remapped,[{pageNumber:3},{pageNumber:4}],3);valid(saved);
 assert.ok(saved.ocrGroups.every(g=>g.page===1||g.page===2),'Native conversion must map OCR with ink');
 const invalid=JSON.parse(JSON.stringify(remapped));invalid.ocrGroups[0].page++;assert.equal(transforms.collectOcrGroups(invalid,new Set(invalid.strokes.map(s=>s.id))).some(g=>g.id===invalid.ocrGroups[0].id),false,'Do not copy a transcript attached to a different page');
 console.log('Session page commands passed: duplicate with new IDs, structure-only duplicate, clear and reordered native-PDF conversion preserve OCR consistency.');


 console.log('OCR page lifecycle passed: insertion, removal, restore, save/reload and 30 repeated page operations preserve recognised groups.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Module._load=previous;require.extensions['.ts']=previousTs});
