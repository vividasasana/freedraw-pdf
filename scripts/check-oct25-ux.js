const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const {loadSource}=require('./load-source'),model=loadSource('src/ocr/model.ts'),display=loadSource('src/ocr/display.ts'),{fitGesture}=loadSource('src/shapes/recognition.ts');
const layout=loadSource('src/ocr/layout.ts');
const src=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',src,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const names=['appendOcrControls','updateCurrentPageFromScroll'];
const ctx={getOcrPageView:model.getOcrPageView};
vm.runInNewContext(ts.transpileModule('class Session{'+names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n')+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
let failed=0;function check(name,fn){try{fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}}
const stroke={id:'ink',page:4,tool:'pen',color:'#55b4ff',width:3,points:[{x:.2,y:.2,pressure:.5},{x:.6,y:.3,pressure:.5}]};
const line={text:'早安',box:{left:.2,top:.2,right:.6,bottom:.3}};
const doc={strokes:[stroke],ocrGroups:[{id:'group',page:4,mode:'text',strokeIds:['ink'],sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot([stroke])),lines:[line]}]};
check('First OCR click acts on the current page, even before toolbar refresh',()=>{
 const s=new ctx.Session(),runs=[],group={children:[],appendChild(e){this.children.push(e)}};
 Object.assign(s,{currentPage:3,annotationDocument:{...doc,ocrGroups:[{...doc.ocrGroups[0],page:3,mode:'ink'},doc.ocrGroups[0]]},createOcrButton:()=>({}),createIconButton:(_icon,label,active,click)=>({label,active,click}),getOcrController:()=>({run:(...args)=>runs.push(args)})});
 s.appendOcrControls(group);s.currentPage=4;group.children[1].click();assert.equal(runs[0][1],'ink');
});
check('Scrolling pages refreshes the OCR state icon',()=>{
 const s=new ctx.Session();let refreshed=0;
 Object.assign(s,{currentPage:3,scrollParent:{getBoundingClientRect:()=>({top:0})},pageSurfaces:new Map([[4,{pageEl:{getBoundingClientRect:()=>({top:28})}}]]),updateNativeMixedPageThumbnailSelection(){},syncNativeMixedPageNavigator(){},refreshToolbar(){refreshed++}});
 s.updateCurrentPageFromScroll();assert.equal(s.currentPage,4);assert.equal(refreshed,1);
});
check('OCR display action is never highlighted as an active drawing tool',()=>{
 const s=new ctx.Session(),group={children:[],appendChild(el){this.children.push(el)}};
 Object.assign(s,{currentPage:4,annotationDocument:doc,createOcrButton:()=>({}),createIconButton:(icon,label,active)=>({icon,label,active})});
 s.appendOcrControls(group);assert.equal(group.children[1].icon,'pen-line');assert.equal(group.children[1].active,false);
 doc.ocrGroups[0].mode='ink';s.appendOcrControls(group);assert.equal(group.children[3].icon,'type');assert.equal(group.children[3].active,false);doc.ocrGroups[0].mode='text';
});
check('Recognised text inherits its source ink colour',()=>assert.equal(display.ocrTextItems(doc,4,1000,1400)[0].color,stroke.color));
check('Multilingual OCR preserves line boxes, colour and scale in both export layers',()=>{
 const texts=['안녕','早安','こんばんは','Morning'],document={...doc,ocrGroups:[{...doc.ocrGroups[0],lines:texts.map((text,i)=>({text,box:{left:.2,top:.2+i*.15,right:.6,bottom:.3+i*.15}}))}]};
 const context={font:'',measureText(text){return {width:Array.from(text).length*700,actualBoundingBoxAscent:750,actualBoundingBoxDescent:150}}};
	 const a=layout.ocrTextRuns(document,4,1.4,context);assert.equal(a.length,4);assert.equal(JSON.stringify(a.map(r=>r.text)),JSON.stringify(texts));
 for(const run of a){assert.equal(run.color,stroke.color);assert.ok(Math.abs(run.fontScale*.9-(run.box.bottom-run.box.top)*1.4)<1e-9);assert.ok(run.horizontalScale>0);}
 const one=layout.selectableOcrTextRuns(context,document,4,500,700),two=layout.selectableOcrTextRuns(context,document,4,2000,2800);
 assert.equal(JSON.stringify(one),JSON.stringify(two),'Export coordinates must not depend on zoom or raster resolution');
 assert.equal(one[1].text,'早安');assert.ok(Math.abs(one[1].width-.4)<1e-9);
});
check('Unchanged OCR redraws skip expensive source validation; edits invalidate the layer',()=>{
 let reads=0;const document={...doc,get strokes(){reads++;return doc.strokes}};
 class Element{constructor(cls=''){this.cls=cls;this.children=[];this.dataset={}}querySelector(){return this.children.find(e=>e.cls==='freedraw-pdf-ocr-text-layer')}createDiv(o){const e=new Element(o.cls);this.children.push(e);return e}replaceChildren(){this.children=[]}addEventListener(){}setAttribute(){}remove(){this.removed=true}}
 const host=new Element();display.syncOcrTextLayer(host,document,4,1000,1400,'revision-1');const first=reads;
 for(let i=0;i<20;i++)display.syncOcrTextLayer(host,document,4,1000,1400,'revision-1');assert.equal(reads,first);
 display.syncOcrTextLayer(host,document,4,1000,1400,'revision-2');assert.ok(reads>first);
});
function polygon(vertices){const out=[];for(let i=1;i<vertices.length;i++)for(let j=0;j<30;j++){const t=j/30;out.push({x:vertices[i-1][0]*(1-t)+vertices[i][0]*t,y:vertices[i-1][1]*(1-t)+vertices[i][1]*t})}return out.concat([{x:vertices.at(-1)[0],y:vertices.at(-1)[1]}])}
check('Rough bowed rectangle fits',()=>assert.equal(fitGesture(polygon([[.2,.2],[.5,.17],[.8,.2],[.81,.65],[.5,.62],[.2,.65],[.18,.4],[.2,.2]]),'auto',1.3)?.tool,'rectangle'));
check('Rough asymmetric circle fits',()=>{
 const points=Array.from({length:150},(_,i)=>{const a=i/149*Math.PI*2,r=1+.10*Math.sin(3*a)+.04*Math.cos(5*a);return{x:.5+.2*r*Math.cos(a),y:.5+.2*r*Math.sin(a)/1.3}});
 assert.equal(fitGesture(points,'auto',1.3)?.tool,'ellipse');
});
check('Shapes popup has no opacity control or long help block',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/ui/shapeOptionsPopover.ts'),'utf8');assert.ok(!source.includes('addSlider'));assert.ok(!source.includes("Opacity"));assert.ok(!source.includes("Appearance"));
});
check('Retired fixed-width toolbar settings are absent',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/settings/settingTab.ts'),'utf8');assert.ok(!source.includes('name: "Toolbar layout"'));assert.ok(!source.includes('name: "Fixed toolbar width"'));
});
check('Left alignment overrides native parent spacing and cleans up on detach',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8');
 assert.ok(src.includes('nativeToolbarEl.classList.add("has-freedraw-pdf-toolbar")'));
 assert.ok(src.includes('this.rootEl?.parentElement?.classList.remove("has-freedraw-pdf-toolbar")'));
 assert.ok(css.includes('.pdf-toolbar.has-freedraw-pdf-toolbar { justify-content: flex-start; }'));
});
process.exitCode=failed?1:0;
