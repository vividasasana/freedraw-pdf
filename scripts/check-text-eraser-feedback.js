const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{loadSource}=require('./load-source');
const source=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const names=['handleSessionKeyDown','handleInlineTextEditorShortcut','activateInlineTextKeyboardScope','releaseInlineTextKeyboardScope','handleSessionWindowBlur','handleSessionWindowFocus','appendEraserSessionPoint','applyEraserSession','applySegmentEraserSession','eraseCommittedLayerAlongPath'];
class Scope {constructor(parent){this.parent=parent;this.keys=[]}register(modifiers,key,run){this.keys.push({modifiers,key,run})}}
let id=0;const context={Scope,...loadSource('src/annotation/geometry.ts'),...loadSource('src/annotation/eraser.ts'),...loadSource('src/interaction/toolShortcuts.ts'),isDomElement:value=>!!value?.closest,generateId:()=>`fragment-${++id}`};
vm.runInNewContext(ts.transpileModule('class Session{'+names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n')+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
const failures=[];const check=(name,test)=>{try{test();console.log('PASS '+name)}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message)}};
const keyboardSession=()=>Object.assign(new context.Session(),{shapeGestureOptions:null,inlineTextEditorEl:null,selectedTargets:[],isSessionKeyboardActive:()=>false,isSessionShortcutActive:()=>false,hasActiveTransientRender:()=>false});
for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])check('Editing text keeps '+key+' away from PDF navigation without blocking its default caret action',()=>{
 const s=keyboardSession(),editor={closest:()=>null,ownerDocument:{}};editor.ownerDocument.activeElement=editor;s.inlineTextEditorEl=editor;
 for(const modifiers of [{},{shiftKey:true},{ctrlKey:true},{metaKey:true}]){
  const event={key,target:editor,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,...modifiers,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},stopImmediatePropagation(){this.stopped=true;this.immediate=true}};
  s.handleSessionKeyDown(event);let page=2;if(!event.stopped)page+=key==='ArrowLeft'?-1:1;
  assert.equal(page,2,'PDF page handler still receives the text-editor arrow');assert.ok(!event.prevented,'Browser caret/selection must remain enabled');
 }
});
check('Arrow navigation outside the editor is unchanged for every tool',()=>{
 for(const tool of ['pen','highlighter','eraser','select','text','line','rectangle','ellipse','triangle','region'])for(const key of ['ArrowLeft','ArrowRight']){
  const s=keyboardSession();s.currentTool=tool;const event={key,target:{},preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},stopImmediatePropagation(){this.stopped=true}};s.handleSessionKeyDown(event);assert.ok(!event.prevented&&!event.stopped,tool);
 }
 const s=keyboardSession(),other={},editor={ownerDocument:{activeElement:other}};s.inlineTextEditorEl=editor;const event={key:'ArrowRight',target:other,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}};s.handleSessionKeyDown(event);assert.ok(!event.prevented&&!event.stopped,'An unfocused editor must not claim another field');
});
check('PDF key scope claims arrows only while the inline editor is focused and releases on blur',()=>{
 const stack=[],s=keyboardSession(),editor={ownerDocument:{}};editor.ownerDocument.activeElement=editor;s.inlineTextEditorEl=editor;s.leaf={view:{scope:{}}};s.plugin={app:{keymap:{pushScope:scope=>stack.push(scope),popScope:scope=>stack.splice(stack.indexOf(scope),1)}}};
 s.activateInlineTextKeyboardScope(editor);assert.equal(stack.length,1);assert.deepEqual(stack[0].keys.map(item=>item.key),['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);assert.ok(stack[0].keys.every(item=>item.modifiers===null&&item.run()!==false),'Scope must preserve native text caret actions with modifiers');
 s.handleSessionWindowBlur();assert.equal(stack.length,0);s.handleSessionWindowFocus();assert.equal(stack.length,1);s.releaseInlineTextKeyboardScope();assert.equal(stack.length,0);s.releaseInlineTextKeyboardScope();assert.equal(stack.length,0);editor.ownerDocument.activeElement={};s.activateInlineTextKeyboardScope(editor);assert.equal(stack.length,0,'Unfocused editor cannot claim PDF arrows');
});
const {shapeGeometry,shapeIntersectsSegment}=loadSource('src/shapes/shapeGeometry.ts');
check('Slow continuous erasing keeps the whole sweep, not only the final point',()=>{
 const s=Object.assign(new context.Session(),{eraserSessionPoints:[],getEraserThreshold:()=>.04,annotationDocument:{shapes:[],textItems:[],strokes:[.2,.4,.6,.8].map((y,i)=>({id:'slow-'+i,page:1,tool:i%2?'highlighter':'pen',width:8,widthScale:.008,color:'#55b4ff',createdAt:'fixture',points:[{x:.1,y,pressure:.5},{x:.9,y,pressure:.5}]}))}});
 for(let i=0;i<=200;i++)s.appendEraserSessionPoint(1,{x:.5,y:.1+i*.004,pressure:.5});
 assert.equal(s.eraserSessionPoints[0].y,.1,'The start of the erase sweep was overwritten');assert.ok(s.eraserSessionPoints.length>2,'Continuous movement collapsed to one endpoint');
 assert.ok(s.applySegmentEraserSession(1,s.eraserSessionPoints,.04));assert.ok(s.annotationDocument.strokes.every(stroke=>stroke.points.every(point=>point.x<.49||point.x>.51)),'Earlier erased pen/highlighter lines returned on release');
});
for(const appearance of ['pen','highlighter'])for(const lineStyle of ['solid','wavy'])check('Touch erase stays erased after release for '+appearance+' '+lineStyle,()=>{
 const shape={id:'line',page:1,tool:'line',appearance,color:'#55b4ff',width:12,widthScale:.012,opacity:appearance==='pen'?.96:.24,lineStyle,waveSize:1.5,aspectRatio:1,start:{x:.1,y:.5},end:{x:.9,y:.5},createdAt:'fixture'};
 const points=[{x:.5,y:.2,pressure:.5},{x:.5,y:.8,pressure:.5}],document={strokes:[],shapes:[shape],textItems:[]};
 const s=Object.assign(new context.Session(),{annotationDocument:document,eraserMode:'segment',eraserSessionPoints:points,ocrHiddenStrokeIds:new Set(),documentRevision:0,getEraserThreshold:()=>.04,getToolPreviewRadius:()=>40,invalidateAnnotationPageCache(){},scheduleSave(){},svgRenderer:{erase(){s.previewErased=true}}});
 assert.ok(shapeIntersectsSegment(shape,points[0],points[1],.04),'Fixture must cross visible ink');s.eraseCommittedLayerAlongPath({vectorEl:{},lastWidth:1000,lastHeight:1000},...points);assert.ok(s.previewErased,'Live erasing path not reached');
 assert.equal(s.applyEraserSession(1),true,'Preview-erased line is unchanged on release');
 assert.ok(!document.shapes.some(item=>shapeIntersectsSegment(item,points[0],points[1],.01)),'Erased line restored in the saved render projection');
 const remaining=(document.strokes.length?document.strokes.flatMap(stroke=>stroke.points):document.shapes.flatMap(item=>shapeGeometry(item).paths.flat()));assert.ok(remaining.some(p=>p.x<.3)&&remaining.some(p=>p.x>.7),'Touch erase must keep both untouched sides');
});
check('Cut shapes preserve patterns, cloning and relative geometry through save/move/resize',()=>{
 const {eraseShapeSegmentsAlongPath}=loadSource('src/annotation/eraser.ts'),{normalizeShapeFields}=loadSource('src/shapes/shapeOptions.ts'),{cloneAnnotationsForPage}=loadSource('src/annotation/interaction.ts');
 for(const tool of ['line','rectangle','ellipse','triangle'])for(const lineStyle of tool==='line'?['solid','dashed','dotted','wavy']:['solid']){
  const shape={id:'shape',page:1,tool,color:'#55b4ff',width:8,widthScale:.008,opacity:.24,appearance:'highlighter',lineStyle,waveSize:1.5,aspectRatio:1,start:{x:.1,y:.2},end:{x:.9,y:.8},createdAt:'fixture'},doc={shapes:[shape],strokes:[],textItems:[]};
  const untouched={...JSON.parse(JSON.stringify(shape)),id:'other',page:2};doc.shapes.push(untouched);
  assert.ok(eraseShapeSegmentsAlongPath(doc,1,[{x:.5,y:0,pressure:.5},{x:.5,y:1,pressure:.5}],.04),tool+' '+lineStyle);assert.equal(doc.shapes.find(s=>s.id==='other'),untouched,'Another page changed');
  const cut=doc.shapes.find(s=>s.id==='shape'),geometry=shapeGeometry(cut);assert.ok(cut.clippedGeometry);assert.equal(cut.lineStyle,lineStyle);assert.equal(cut.opacity,.24);
  const reopened=normalizeShapeFields(JSON.parse(JSON.stringify(cut)));assert.equal(JSON.stringify(shapeGeometry(reopened)),JSON.stringify(geometry),'Save/reload restored erased parts');
  const copy=cloneAnnotationsForPage([],[],[cut],2).shapes[0];assert.equal(JSON.stringify(shapeGeometry(copy)),JSON.stringify(geometry));copy.clippedGeometry.paths[0]?.[0]&&(copy.clippedGeometry.paths[0][0].x+=.02);assert.equal(JSON.stringify(shapeGeometry(cut)),JSON.stringify(geometry),'Copy aliases cut geometry');
  const moved={...reopened,start:{x:reopened.start.x+.05,y:reopened.start.y+.05},end:{x:reopened.end.x+.05,y:reopened.end.y+.05}},movedGeometry=shapeGeometry(moved);
  geometry.paths.forEach((path,i)=>path.forEach((p,j)=>{assert.ok(Math.abs(movedGeometry.paths[i][j].x-p.x-.05)<1e-10);assert.ok(Math.abs(movedGeometry.paths[i][j].y-p.y-.05)<1e-10)}));
  const scaled={...reopened,end:{...reopened.end,x:reopened.start.x+(reopened.end.x-reopened.start.x)*.5,y:reopened.start.y+(reopened.end.y-reopened.start.y)*.5}},scaledGeometry=shapeGeometry(scaled);
  geometry.paths.forEach((path,i)=>path.forEach((p,j)=>assert.ok(Math.abs(scaledGeometry.paths[i][j].x-(reopened.start.x+(p.x-reopened.start.x)*.5))<1e-10)));
 }
});
process.exitCode=failures.length?1:0;
