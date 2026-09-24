const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
function load(relative,overrides={}) {
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>overrides[n]??require(n),console,performance,Map,Set},{filename:relative});return module.exports;
}
const input=load('src/pointer/pointerInput.ts',{'../utils/deviceUtils':{getInputMethod:e=>e.pointerType,isTabletWebKitTouchDevice:()=>true},'../utils/general':{clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},'../tools/toolState':{isShapeTool:()=>false}});
const finger={pointerType:'touch',width:3,height:3,pressure:0.3,isPrimary:true};
assert.equal(input.shouldPanAnnotationPointerEvent(finger,'pen','pen-mouse-only'),true,'Small Android finger contacts must pan despite pressure');
assert.equal(input.shouldIgnoreInkPointerEvent(finger,'pen','pen-mouse-only'),true);
assert.equal(input.isStylusLikePointerEvent({...finger,pointerType:'pen'}),true);
assert.equal(input.isStylusLikePointerEvent({...finger,touchType:'stylus'}),true);
const keys=load('src/interaction/toolShortcuts.ts');
const key={key:'1',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false};
assert.equal(keys.resolveToolShortcut(key),'pen');
assert.equal(keys.resolveToolShortcut({...key,key:'4'}),'select');
for(const flag of ['ctrlKey','metaKey','altKey','shiftKey','repeat','isComposing'])assert.equal(keys.resolveToolShortcut({...key,[flag]:true}),null);
const main=fs.readFileSync(path.join(root,'main.ts'),'utf8');
const method=main.slice(main.indexOf('\tprivate getLivePreviewPredictionStrength():'),main.indexOf('\n\tprivate drawStroke(',main.indexOf('\tprivate getLivePreviewPredictionStrength():')));
const context={};vm.runInNewContext(ts.transpileModule('class Session {'+method+'}\nglobalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
const session=new context.Session();session.plugin={getLivePreviewMode:()=> 'balanced'};
assert.equal(session.getLivePreviewPredictionStrength(),0,'Default live ink must not predict geometry that disappears at pen-up');
const ink=load('src/ink/inkEngine.ts');
const points=Array.from({length:100},(_,i)=>({x:0.1+i*0.006,y:0.4+Math.sin(i*0.08)*0.02+(i%2?0.0008:-0.0008),pressure:0.5,t:i*8}));
const live=ink.getSmoothInkStrokeOutline(points,1000,1400,4,true,true,{predictionStrength:session.getLivePreviewPredictionStrength()});
const saved=ink.getSmoothInkStrokeOutline(points,1000,1400,4,true,false);
assert.deepEqual(live,saved,'Same samples must render identically live and saved');
const cut=ink.getSmoothInkStrokeOutline(points,1000,1400,4,true,false,{startCap:true,endCap:true});
assert.deepEqual(cut,saved,'Rounded cut caps must match the natural untapered endpoints');
ink.setInkRenderSettings({taperStart:20,taperEnd:35});
const zoomOne=ink.getSmoothInkStrokeOutline(points,1000,1400,4,true,false);
const zoomTwo=ink.getSmoothInkStrokeOutline(points,2000,2800,8,true,false);
assert.equal(zoomOne.length,zoomTwo.length,'Tapered stroke geometry must be independent of zoom');
zoomOne.forEach((point,i)=>point.forEach((value,j)=>assert.ok(Math.abs(value-zoomTwo[i][j]/2)<1e-8)));
console.log('V2 interactions passed: finger/pen distinction, modifier-safe tool keys, stable live ink, clean eraser caps.');

// Hovering with another tool must still give a newly selected eraser a position.
const tree=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
const sessionNode=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='NativePdfAnnotatorSession');
const previewMethods=['handleViewPointerMove','updateToolPreview','refreshToolPreviewFromLastPointer','hideToolPreview','getToolPreviewRadius'];
const previewCode=sessionNode.members.filter(member=>previewMethods.includes(member.name?.getText(tree))).map(member=>member.getText(tree)).join('\n');
const previewContext={shouldPanAnnotationPointerEvent:input.shouldPanAnnotationPointerEvent};
vm.runInNewContext(ts.transpileModule('class Session {'+previewCode+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,previewContext);
const preview=new previewContext.Session(),classes=new Set(['is-hidden']),previewStyle={};
const pointerState={clientX:null,clientY:null};
Object.assign(preview,{
 annotationMode:true,currentTool:'pen',fingerPanPointerId:null,erasingSession:false,
 previewState:{snapshot:pointerState,recordPointer(x,y){Object.assign(pointerState,{clientX:x,clientY:y})},show(){},hide(){}},
 toolPreviewEl:{classList:{add(...names){names.forEach(name=>classes.add(name))},remove(...names){names.forEach(name=>classes.delete(name))}},setCssStyles(value){Object.assign(previewStyle,value)}},
 toolState:{getWidth:()=>40},getViewContentEl:()=>({getBoundingClientRect:()=>({left:10,top:20})}),
 getInkInputPolicy:()=> 'pen-mouse-only',updateOverlayCursorForPointer(){}
});
preview.handleViewPointerMove({pointerType:'mouse',pointerId:1,clientX:150,clientY:180});
assert.ok(classes.has('is-hidden'),'Pen hover must not paint the eraser ring');
preview.currentTool='eraser';
preview.refreshToolPreviewFromLastPointer();
assert.ok(!classes.has('is-hidden'),'Switching to eraser must immediately restore its ring at the last pointer position');
assert.equal(previewStyle.left,'120px');
assert.equal(previewStyle.top,'140px');
assert.equal(previewStyle.width,'40px');
preview.erasingSession=true;
preview.handleViewPointerMove({pointerType:'pen',pointerId:2,clientX:170,clientY:200});
assert.ok(classes.has('is-active'),'Stylus erasing must retain the active pointer ring');
preview.handleViewPointerMove({...finger,pointerId:3,clientX:170,clientY:200});
assert.ok(classes.has('is-hidden'),'Finger navigation must not show an eraser ring');
preview.getInkInputPolicy=()=> 'allow-touch';
preview.handleViewPointerMove({...finger,pointerId:3,clientX:170,clientY:200});
assert.ok(!classes.has('is-hidden'),'Finger erasing must show the pointer when finger drawing is enabled');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const zIndex=selector=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
 .filter(rule=>rule[1].trim().split(/,\s*/).includes(selector))
 .map(rule=>Number(rule[2].match(/z-index:\s*(\d+)/)?.[1])).filter(Number.isFinite).at(-1);
const ringZ=zIndex('.pdf-native-annotator-tool-preview');
for(const layer of ['.pdf-native-annotator-template-background','.pdf-native-annotator-overlay','.pdf-native-annotator-transient']) {
 assert.ok(ringZ>zIndex(layer),'The eraser pointer must paint above '+layer);
}
assert.ok(ringZ<zIndex('.pdf-native-annotator-ui'),'Toolbars must remain above the pointer');
console.log('Eraser pointer passed: immediate tool switching, mouse/stylus/finger routing, size and layer visibility.');
