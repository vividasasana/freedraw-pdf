const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),{loadSource}=require('./load-source');
const model=loadSource('src/ocr/model.ts'),{fitGesture}=loadSource('src/shapes/recognition.ts'),{HoldGesture}=loadSource('src/shapes/holdGesture.ts');
const source=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const names=['moveSelectedTarget','moveSelectedTargetsWithinPage','syncSelectableText'];
const ctx={...loadSource("src/ocr/transforms.ts"),...loadSource('src/ocr/display.ts'),syncReadOnlyTextLayer(){},clamp:(n,a,b)=>Math.max(a,Math.min(b,n))};
vm.runInNewContext(ts.transpileModule('class Session{'+names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n')+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
let failures=0;const check=(name,test)=>{try{test();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.message)}};
check('OCR text mounts on the shared fast-render/overlay path',()=>{
 class Element{constructor(cls='',text=''){this.cls=cls;this.textContent=text;this.children=[];this.dataset={};}querySelector(selector){return this.children.find(e=>selector.includes(e.cls))??null}createDiv(options){const el=new Element(options.cls,options.text);this.children.push(el);return el}replaceChildren(){this.children=[]}setAttribute(){}addEventListener(){}setCssStyles(){}setCssProps(){}remove(){}}
 const strokes=[{id:'one',page:1,tool:'pen',color:'#000000',width:3,points:[{x:.2,y:.2,pressure:.5},{x:.4,y:.4,pressure:.5}]}];
 const doc={strokes,ocrGroups:[{id:'group',page:1,strokeIds:['one'],sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot(strokes)),text:'Hi',lines:[{text:'Hi',box:{left:.2,top:.2,right:.4,bottom:.4}}],mode:'text'}]};
 const s=new ctx.Session(),host=new Element();Object.assign(s,{annotationDocument:doc,annotationMode:false,shouldKeepPageHot:()=>true,getPageAnnotationBucket:()=>({textItems:[]})});
 s.syncSelectableText({pageNumber:1,hostEl:host,lastWidth:1000,lastHeight:1400});
 assert.equal(host.children.find(e=>e.cls==='freedraw-pdf-ocr-text-layer')?.children[0]?.textContent,'Hi');
});
check('Moving recognised handwriting retains selectable text',()=>{
 const strokes=[{id:'one',page:1,tool:'pen',color:'#000000',width:3,points:[{x:.2,y:.2,pressure:.5},{x:.4,y:.4,pressure:.5}]}];
 const document={strokes,textItems:[],shapes:[],ocrGroups:[{id:'group',page:1,strokeIds:['one'],sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot(strokes)),text:'Hi',lines:[{text:'Hi',box:{left:.2,top:.2,right:.4,bottom:.4}}],mode:'text'}]};
 const s=new ctx.Session();s.annotationDocument=document;s.getCombinedBounds=()=>({left:.2,top:.2,right:.4,bottom:.4});
 s.moveSelectedTargetsWithinPage([{kind:'stroke',id:'one',page:1}],.1,.1);
 assert.equal(model.getOcrPageView(document,1).groups.length,1);
 assert.ok(Math.abs(document.ocrGroups[0].lines[0].box.left-.3)<1e-8);
});
check('Stationary Pencil jitter still triggers hold',()=>{
 let now=0,id=0,fit=0;const tasks=new Map(),clock={setTimeout(fn,ms){tasks.set(++id,{fn,at:now+ms});return id},clearTimeout(id){tasks.delete(id)}};
 const hold=new HoldGesture(clock,{x:.5,y:.5},{width:1000,height:1000,tolerance:4},()=>{fit++;return true},()=>{});
 for(let i=1;i<=8;i++){now+=100;hold.move({x:.5+(i%2?1:-1)*.0012,y:.5});for(const [id,task]of [...tasks])if(task.at<=now){tasks.delete(id);task.fn()}}
 assert.equal(fit,1);hold.cancel();
});
function polyline(vertices){const p=[];for(let i=1;i<vertices.length;i++)for(let j=0;j<25;j++){const t=j/25;p.push({x:vertices[i-1][0]*(1-t)+vertices[i][0]*t,y:vertices[i-1][1]*(1-t)+vertices[i][1]*t})}return p.concat([{x:vertices.at(-1)[0],y:vertices.at(-1)[1]}]);}
check('Rough almost-closed rectangle recognised',()=>assert.equal(fitGesture(polyline([[.2,.2],[.8,.23],[.78,.7],[.21,.68],[.2,.36]]),'auto',1)?.tool,'rectangle'));
check('Rough almost-closed triangle recognised',()=>assert.equal(fitGesture(polyline([[.5,.2],[.82,.7],[.2,.7],[.4,.39]]),'auto',1)?.tool,'triangle'));
process.exitCode=failures?1:0;


