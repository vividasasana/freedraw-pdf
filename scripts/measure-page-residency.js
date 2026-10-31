// Deterministic synthetic-data CPU harness, not a browser-paint or iPad latency benchmark.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{loadSource}=require('./load-source');
const {SvgAnnotationRenderer,SvgDrawingContext}=loadSource('src/render/svgDrawingContext.ts');
const {PageResidencyCache}=loadSource('src/render/pageResidencyCache.ts');
const ink=loadSource('src/ink/inkEngine.ts'),{annotationOpacity}=loadSource('src/shapes/shapeOptions.ts');
const {getAnnotationRenderables}=loadSource('src/annotation/renderOrder.ts');
const {runCooperativeRenderSlice}=loadSource('src/render/cooperativeRender.ts');
const {DEFAULT_SETTINGS}=loadSource('src/config.ts');
const source=fs.readFileSync(path.resolve(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const names=['getPageFrameKey','startPageRenderJob','drawStroke','paintStroke','drawReliablePdfStroke','getCachedStrokeOutline','getStrokePathSignature','releasePageCanvasResources','getPageRetainedCost','reconcileWarmPageResidency','scheduleWarmPageEviction'];
const methods=names.map(name=>cls.members.find(n=>n.name?.getText(tree)===name).getText(tree)).join('\n');
const ctx={performance,MAX_STROKE_WIDTH_SCALE:.08,SvgDrawingContext,annotationOpacity,getAnnotationRenderables,...ink};
vm.runInNewContext(ts.transpileModule('class Session{'+methods+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
let allocated=0;
class Node{
 constructor(tag='g',attrs={}){this.localName=tag;this.attrs={...attrs};this.children=[];this.ownerDocument=doc;this.isConnected=true;this.parent=null;this.classList={add(){},remove(){}};allocated++;}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value:String(value)}));}
 createSvg(tag,options={}){const n=new Node(tag,options.attr);this.appendChild(n);return n;}
 appendChild(n){n.remove();this.children.push(n);n.parent=this;return n;}
 insertBefore(n,next){n.remove();const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,n);n.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 replaceChildren(){for(const child of this.children)child.parent=null;this.children=[];}
 setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
 get firstChild(){return this.children[0]??null;}get childElementCount(){return this.children.length;}
 get nextSibling(){const siblings=this.parent?.children??[];return siblings[siblings.indexOf(this)+1]??null;}
 setCssStyles(){} querySelector(){return null;}
}
const doc={defaultView:{createFragment:()=>new Node('fragment')}};
const strokes=Array.from({length:850},(_,i)=>({id:'synthetic-'+i,page:1,tool:'pen',color:'#333333',width:3,widthScale:.003,inkSettings:{...DEFAULT_SETTINGS.inkRenderSettings},points:Array.from({length:6},(_,j)=>({x:.025+(i%25)*.038+j*.0018,y:.02+Math.floor(i/25)*.028+Math.sin(j*.45)*.006,pressure:.4+Math.sin(j*.2)*.1,t:j*8}))}));
const renderer=new SvgAnnotationRenderer(),root=new Node('svg'),overlay={width:1,height:1,isConnected:true};
const surface={pageNumber:1,lastWidth:1000,lastHeight:1400,vectorEl:root,overlayEl:overlay,transientEl:{width:1,height:1},hostEl:new Node('host')};
const s=new ctx.Session();let jobs=0;
Object.assign(s,{annotationDocument:{strokes},pageSurfaces:new Map([[1,surface]]),pageResidency:new PageResidencyCache(),pageResidencyEvictionHandle:null,svgRenderer:renderer,ownerWindow:{devicePixelRatio:1,createEl:()=>({width:1,height:1}),setTimeout:()=>1,clearTimeout(){}},selectedTargets:[],inlineTextTargetId:null,inlineTextPageNumber:null,lastSelectionRegion:null,focusedRegion:null,pointerPage:null,renderRevision:0,annotationPageRevisions:new Map(),publishedFrames:new WeakMap(),pageRenderSlots:new Map(),snapshotCanvases:new Set(),strokePathCache:new Map(),strokePointHashCache:new WeakMap(),pageRenderVersions:new Map(),pageRenderJobs:new Map(),renderInputEpoch:0,pendingRedrawPages:new Set(),isViewportMotionActive:()=>false,hasActiveTransientRender:()=>false,ensureOverlayLayerOrder(){},resizeOverlay(){},syncSelectableText(){},createSvgDrawingContext:sf=>renderer.create(sf.vectorEl,sf.lastWidth,sf.lastHeight),getAnnotationPixelRatio:()=>1,getPageAnnotationBucket:()=>({strokes,textItems:[],shapes:[],imageItems:[]}),getInlineTextPreviewItem:()=>null,renderTelemetry:{recordRenderQueued(){jobs++;}},schedulePageRenderJobs(){},resolveStoredScale:(_w,scale)=>scale,shouldKeepPageHot:()=>false,isPageNearViewport:()=>false,cancelPageRenderJob(n){this.pageRenderJobs.delete(n);}});
function revisit(){const before=allocated,start=performance.now();let maxSliceMs=0,slices=0;s.startPageRenderJob(1);const job=s.pageRenderJobs.get(1);if(job){let next=0;while(next<job.steps.length){const slice=performance.now();const result=runCooperativeRenderSlice(job.steps,next,{budgetMs:4,now:()=>performance.now(),isInputPending:()=>false});next=result.nextStep;maxSliceMs=Math.max(maxSliceMs,performance.now()-slice);slices++;}renderer.publish(job.vectorFrame);s.publishedFrames.set(overlay,s.getPageFrameKey(surface));s.pageRenderJobs.delete(1);}return{ms:performance.now()-start,nodesAllocated:allocated-before,maxSliceMs,slices};}
revisit();
const beforeNode=root.children[0].children[0],retained=renderer.getRetainedCost(root);
const pathCharacters=root.children[0].children.reduce((sum,node)=>sum+(node.getAttribute('d')?.length??0),0);
s.reconcileWarmPageResidency();assert.equal(s.pageResidency.has(1),true,'Synthetic dense page must fit warm residency budgets');
const warm=[];for(let i=0;i<10;i++)warm.push(revisit());
assert.equal(root.children[0].children[0],beforeNode,'Warm revisit must keep identical SVG nodes');
assert.ok(warm.every(x=>x.nodesAllocated===0),'Warm revisit must allocate no SVG geometry');
const cold=[];for(let i=0;i<10;i++){s.releasePageCanvasResources(1);cold.push(revisit());}
assert.ok(cold.every(x=>x.nodesAllocated>=850),'Legacy immediate eviction must remount all 850 stroke nodes');
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const result={kind:'Node CPU/mock-DOM replay; no browser paint or device latency; total CPU work across cooperative slices',strokes:850,samplesPerStroke:6,passes:10,warm:{meanMs:mean(warm.map(x=>x.ms)),maxMs:Math.max(...warm.map(x=>x.ms)),allocatedNodes:warm.reduce((a,b)=>a+b.nodesAllocated,0)},immediateEvictionBaseline:{meanMs:mean(cold.map(x=>x.ms)),maxMs:Math.max(...cold.map(x=>x.ms)),longestCooperativeSliceMs:Math.max(...cold.map(x=>x.maxSliceMs)),allocatedNodes:cold.reduce((a,b)=>a+b.nodesAllocated,0)},retainedCostEstimate:retained,pathCharacters,renderJobs:jobs};
console.log(JSON.stringify(result,null,2));
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');



