const fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
function sessionClass(names, globals = {}, className = 'NativePdfAnnotatorSession') {
 const node = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === className);
 const methods = names.map(name => { const member = node.members.find(m => m.name?.getText(tree) === name); assert.ok(member, name); return member.getText(tree); }).join('\n');
 const context = {console, ...globals};
 vm.runInNewContext(ts.transpileModule('class Session {' + methods + '} globalThis.Session = Session;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText, context);
 return new context.Session();
}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const s=sessionClass(['insertTemplatePageAfterCurrent','getNativeInsertPageLocation','findSyntheticInsertIndexAfterPdfPage','findFirstSyntheticInsertIndexAfterPdfPage','getSyntheticPageInsertAfterPdfPage'],{clamp});
const pages=[{id:'old',title:'Already after page 1',insertAfterPdfPage:1},{id:'end',insertAfterPdfPage:3}];
Object.assign(s,{realPdfPageCount:3,currentPage:1,getAppendedPages:()=>pages,getSyntheticPageIndex:()=>-1,insertTemplatePageAtIndex:(index,anchor)=>pages.splice(index,0,{id:'new',insertAfterPdfPage:anchor})});
s.insertTemplatePageAfterCurrent();
assert.equal(pages[0].id,'new','Quick add after PDF 1 must be before existing added pages anchored to PDF 1');
assert.equal(pages[0].insertAfterPdfPage,1);
s.currentPage=4;s.getSyntheticPageIndex=()=>0;s.insertTemplatePageAfterCurrent();
assert.equal(pages[1].id,'new','Quick add after a temporary page must be adjacent to that page');

const settings=sessionClass(['refreshSettings']);
Object.assign(settings,{strokePathCache:new Map([['old','outline']]),publishedFrames:new WeakMap(),selectionBackground:{},mountUi(){},applyOverlayMode(){},syncRenderTelemetry(){},refreshToolbar(){},drawAllAnnotations(){this.redrawn=true},invalidateAnnotationPageCache(){this.invalidated=true}});
settings.refreshSettings();
assert.equal(settings.strokePathCache.size,1,'Changing stabilization must keep existing stroke outlines');
assert.ok(!settings.redrawn,'Changing stabilization must not redraw existing ink');

class Menu {
 constructor(){this.items=[]}
 addItem(fn){const item={setTitle(v){this.title=v;return this},setIcon(){return this},setWarning(){return this},onClick(fn){this.run=fn;return this}};fn(item);this.items.push(item);return this}
 addSeparator(){return this}
}
const menuSession=sessionClass(['openAddPageMenu'],{Menu,PAPER_COLOR_PRESETS:[{color:'#ffffff',label:'White'}],getNotebookTemplateLabel:v=>v});
let openedMenu,insertLocation,templateTarget;
Object.assign(menuSession,{currentPage:1,syncCurrentPageForPageAction(){},getCurrentSyntheticPage:()=>null,getCurrentMixedPageOrdinal:()=>1,getMixedPageEntries:()=>[{},{}],getNativeInsertPageLocation:()=>({anchor:1,insertIndex:0}),getNativeInsertPageDefaults:()=>({template:'blank'}),canEditPdfPageTemplate:()=>true,getPdfPageTemplate:()=>({template:'blank',paperColor:'#ffffff'}),showExclusiveMenuAtPosition:menu=>openedMenu=menu,insertTemplatePageAtLocation:location=>insertLocation=location,openPdfPageTemplateMenu:page=>templateTarget=page});
menuSession.openAddPageMenu({getBoundingClientRect:()=>({left:0,bottom:0})});
assert.ok(openedMenu.items.some(item=>item.title==='Template: blank'),'Created PDF must expose template directly in Page menu');
assert.ok(openedMenu.items.some(item=>item.title==='Paper: White'),'Created PDF must expose colour directly in Page menu');
menuSession.currentPage=2;
openedMenu.items.find(item=>item.title==='Quick add after current').run();
assert.equal(insertLocation.anchor,1,'Menu action must retain the page where it was opened');
openedMenu.items.find(item=>item.title==='Template: blank').run({});
assert.equal(templateTarget,1);

const inkSource=fs.readFileSync(path.join(root,'src/ink/inkEngine.ts'),'utf8')+'\nexport {getRenderStrokePoints};';
const inkModule={exports:{}};
vm.runInNewContext(ts.transpileModule(inkSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:inkModule,exports:inkModule.exports,require,console});
const ink=inkModule.exports;
const samples=Array.from({length:35},(_,i)=>({x:.1+i*.006,y:.5+(i%2?.009:-.009),pressure:.5,t:i*8}));
ink.setInkRenderSettings({streamline:0});
assert.equal(ink.getRenderStrokePoints(samples,false),samples,'Zero stabilization must bypass path filtering');
ink.setInkRenderSettings({streamline:1});
const stabilized=ink.getRenderStrokePoints(samples,false);
assert.ok(stabilized.some(p=>Math.abs(p.y-.5)<.004),'High stabilization must reduce alternating wobble');
assert.equal(stabilized[0].x,samples[0].x);
assert.equal(stabilized.at(-1).x,samples.at(-1).x);
let cutOptions;
const renderer=sessionClass(['drawReliablePdfStroke'],{drawSmoothInkStroke:(...args)=>cutOptions=args.at(-1)});
renderer.drawReliablePdfStroke({}, {lastWidth:1000,lastHeight:1400}, {points:samples,cutStart:true,cutEnd:true},4,true,false,true,0);
assert.equal(cutOptions.startCap,true,'Erased heads must be round');
assert.equal(cutOptions.endCap,true,'Erased tails must be round');
assert.equal(cutOptions.startTaper,0,'Erased ends must keep a full rounded cap instead of tapering');
const rounded=ink.getSmoothInkStrokeOutline(samples,1000,1400,4,true,false,cutOptions);
const flat=ink.getSmoothInkStrokeOutline(samples,1000,1400,4,true,false,{...cutOptions,startCap:false,endCap:false});
assert.notDeepEqual(rounded,flat,'Round caps must affect the rendered outline');

async function checkBlankPdf() {
 let canvasFill, sidecar, encodedPages;
 const fakeFile={path:'Notes.pdf',name:'Notes.pdf',stat:{}};
 const creator=sessionClass(['createBlankAnnotatablePdf'],{clamp,BLANK_PDF_EXPORT_WIDTH_PX:1600,createTemplateNotebookPage:(_title,template,pageSize,paperColor)=>({template,pageSize,paperColor}),getNotebookPageRenderDimensions:()=>({width:1600,height:2263}),getNotebookPageSizeDimensions:()=>({width:920,height:1301}),createEl:()=>({width:0,height:0,getContext:()=>({set fillStyle(v){canvasFill=v},fillRect(){}}),toDataURL:()=>''}),dataUrlToArrayBuffer:()=>new ArrayBuffer(0),buildPdfFromJpegPages:p=>{encodedPages=p;return new Uint8Array([1])},createEmptyDocument:()=>({strokes:[]}),Notice:class{}},'PDFAnnotatorPlugin');
 Object.assign(creator,{app:{workspace:{getActiveFile:()=>null},vault:{getAbstractFileByPath:()=>null,createBinary:async()=>fakeFile}},store:{save:async(_f,d)=>sidecar=d},openPdfPage:async()=>{}});
 await creator.createBlankAnnotatablePdf({title:'Notes',template:'grid',pageSize:'a4',paperColor:'#eef6ff',pageCount:1});
 assert.equal(canvasFill,'#ffffff','New PDF bytes must contain a white page, independent of overlay colour');
 assert.equal(encodedPages.length,1);
 assert.equal(sidecar.pdfPageTemplates[0].paperColor,'#eef6ff');
 assert.equal(sidecar.pdfPageTemplates[0].template,'grid');
 assert.equal(sidecar.nativePageTemplatesEditable,true);
 console.log('V2 page-flow checks passed: adjacent quick insertion, setting refresh, white PDF and editable sidecar style.');
}
checkBlankPdf().catch(e=>{console.error(e);process.exitCode=1});
