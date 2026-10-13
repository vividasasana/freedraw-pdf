const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../main.js'),'utf8'),tree=ts.createSourceFile('bundle',source,ts.ScriptTarget.Latest,true);
const edits=[];
function visit(n){if((ts.isClassDeclaration(n)||ts.isClassExpression(n))&&n.members.some(m=>m.name?.getText(tree)==='drawTransientPageAnnotations'))edits.push({n,label:'Session'});if((ts.isClassDeclaration(n)||ts.isClassExpression(n))&&n.members.some(m=>m.name?.getText(tree)==='hasCommittedFrame'))edits.push({n,label:'Renderer'});ts.forEachChild(n,visit);}visit(tree);
let code=source;for(const {n,label} of edits.sort((a,b)=>b.n.pos-a.n.pos)){code=code.slice(0,n.getStart(tree))+`globalThis.${label} = `+code.slice(n.getStart(tree));}
const moduleShim={exports:{}},context={module:moduleShim,exports:moduleShim.exports,console,TextEncoder,require:()=>({Plugin:class{},Modal:class{},TFile:class{},PluginSettingTab:class{},AbstractInputSuggest:class{},Notice:class{}})};
vm.runInNewContext(code,context);
class Node{constructor(){this.ownerDocument={defaultView:{createFragment:()=>new Node()}};this.children=[];this.attrs={};}createSvg(tag,opts={}){const n=new Node();n.attrs=opts.attr||{};this.children.push(n);return n;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}appendChild(n){n.remove();this.children.push(n);n.parent=this;}replaceChildren(){this.children=[];}remove(){if(this.parent){const i=this.parent.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);}}get firstChild(){return this.children[0];}get childElementCount(){return this.children.length;}insertBefore(n){if(!this.children.includes(n))this.children.push(n);}}
const ink={inkModel:'continuous-v1',strokeGeometry:'round',edgeGeometryVersion:2,widthSmoothing:'extra-smooth',widthSmoothingVersion:2,smoothingMode:'pressure',pressureResponse:'gentle',thinning:.35,streamline:.5,smoothing:.7,easing:'linear',taperStart:0,taperEnd:0,pressureMode:'stylus'};
const raw=[];let reads=0;const points=new Proxy(raw,{get(t,k){if(/^\d+$/.test(String(k)))reads++;return Reflect.get(t,k);}});
const stroke={id:'long',page:1,tool:'pen',width:8,widthScale:.008,color:'#000',points,inkSettings:ink};
const session=Object.create(context.Session.prototype),root=new Node(),surface={lastWidth:1000,lastHeight:1400,vectorEl:root};
Object.assign(session,{svgRenderer:new context.Renderer(),plugin:{getLivePreviewMode:()=> 'auto-smooth'},resolveStoredScale:(_w,s)=>s});
function frame(){reads=0;const drawing=session.createSvgDrawingContext(surface);session.drawStroke(drawing,surface,stroke,false,true,0);return reads;}
let early;for(let i=0;i<2048;i++){raw.push({x:.5+Math.cos(i*.025)*.2,y:.5+Math.sin(i*.025)*.15,pressure:.5+Math.sin(i*.037)*.2,t:i*4});if(i%64===63){const work=frame();if(i===127)early=work;if(i===2047){console.log({earlyReads:early,lateReads:work});assert.ok(work<512,'Long-stroke live geometry must not reprocess all earlier points every frame');}}}


const before=frame();raw[raw.length-1]={...raw.at(-1),pressure:.9};
assert.ok(frame()>0,'Updating the last pressure sample without appending must refresh the tail');
assert.equal(raw.length,2048,'Preview must retain every input sample');
const drawing=session.createSvgDrawingContext(surface);
assert.equal(drawing.reuseLiveContinuousStroke(stroke,8),true,'Accurate preview must be reusable at Pencil lift');
assert.equal(drawing.records[0].node.attrs.opacity,.96,'Use group opacity so chunk overlaps do not darken');
