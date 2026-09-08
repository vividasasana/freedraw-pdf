const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../main.ts'),'utf8');
function method(start,end,globals={}) {
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Method extraction must find both ends');
 const context={console,...globals};
 vm.runInNewContext(ts.transpileModule('class Session {'+source.slice(a,b)+'}\nglobalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
 return new context.Session();
}
let readbacks=0,copies=0;
const targetContext={save(){},restore(){},setTransform(){},clearRect(){},drawImage(){copies++},putImageData(){}};
const canvas={width:2400,height:3200,getContext:()=>({getImageData(){readbacks++;return {}}})};
const session=method('\tprivate publishRenderedCanvas(', '\n\tprivate cancelPageRenderJobs(');
session.publishRenderedCanvas(canvas,{width:2400,height:3200,getContext:()=>targetContext});
assert.equal(readbacks,0,'Publishing a page must not synchronously read back every pixel');
assert.equal(copies,1);
// Native textarea must paint typing immediately, independent of PDF page rendering.
const inputStart=source.indexOf('editor.addEventListener("input", () => {');
const inputEnd=source.indexOf('\n\t\t});',inputStart);
assert.ok(inputStart>=0);
assert.ok(!source.slice(inputStart,inputEnd).includes('drawPageAnnotations'),'Typing must not redraw all page annotations for each character');
const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
assert.ok(css.includes('-webkit-text-fill-color: var(--annotator-inline-text-color'),'Native text must remain visible while typing');
console.log('V2 rendering passed: no full-page readback on publication; native text does not rerender the PDF on input.');

let backgroundDraws=0, selectedDraws=0;
const fakeContext={save(){},restore(){},setTransform(){},clearRect(){},drawImage(){}};
const fakeCanvas={width:1000,height:1400,getContext:()=>fakeContext};
const preview=method('\tprivate drawSelectionPreview(', '\n\tprivate drawPageAnnotations(', {getAnnotationRenderables:(strokes)=>strokes.map(annotation=>({kind:'stroke',annotation}))});
const strokes=Array.from({length:1001},(_,i)=>({id:String(i),page:1}));
Object.assign(preview,{dragAnchor:{x:0,y:0},currentLasso:null,selectedTargets:[{id:'1000',page:1,kind:'stroke'}],selectionBackground:null,ownerWindow:{devicePixelRatio:1},ownerDocument:{createElement:()=>({...fakeCanvas})},getPageAnnotationBucket:()=>({strokes,textItems:[],shapes:[],imageItems:[]}),drawStroke:(c,s,stroke)=>{if(stroke.id==='1000')selectedDraws++;else backgroundDraws++},drawText(){},drawShape(){},drawImageAnnotation(){},drawSelection(){},publishRenderedCanvas(){}});
const surface={pageNumber:1,lastWidth:1000,lastHeight:1400,overlayEl:fakeCanvas};
assert.equal(preview.drawSelectionPreview(surface),true);
for(let i=0;i<20;i++)preview.drawSelectionPreview(surface);
assert.equal(backgroundDraws,1000,'Stationary annotations must be rendered once per drag, not every frame');
assert.equal(selectedDraws,21,'Selected annotations must follow every preview frame');
console.log('Selection replay passed: 1,000 stationary strokes rendered once across 21 drag frames.');
