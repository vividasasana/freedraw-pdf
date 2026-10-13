const assert=require('node:assert/strict'),{loadSource}=require('./load-source');
const {ScrollPreviewCache}=loadSource('src/render/scrollPreviewCache.ts');
class Node{constructor(){this.localName="g";this.ownerDocument=doc;this.isConnected=true;this.children=[];this.listeners={};this.attrs={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}createSvg(_tag,opts={}){const n=new Node();n.localName=_tag;n.attrs=opts.attr||{};this.children.push(n);n.parent=this;return n;}insertBefore(n,before){n.remove();const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,n);n.parent=this;}addEventListener(n,fn){this.listeners[n]=fn;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}get firstChild(){return this.children[0]||null;}get firstElementChild(){return this.firstChild;}get childElementCount(){return this.children.length;}get nextSibling(){const a=this.parent?.children||[];return a[a.indexOf(this)+1]||null;}appendChild(n){n.remove();this.children.push(n);n.parent=this;}replaceChildren(){this.children=[];}getBoundingClientRect(){return{left:0,top:0,width:1000,height:1400};}setAttribute(k,v){this.attrs[k]=v;}remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}emit(n){this.listeners[n]?.();}}
const doc={defaultView:{createFragment:()=>new Node(),innerWidth:1000,innerHeight:1400}};
async function run(){
 let disposed=0,built=0;const factory=async()=>{built++;return{href:'blob:preview',width:100,height:140,bytes:100,dispose(){disposed++;}}};
 const cache=new ScrollPreviewCache(factory,220,2),root=new Node(),body=new Node();
 assert.equal(await cache.prepare(root,body,1000,1400,()=>true),true);
 assert.equal(cache.show(root),false,'Never hide SVG before the image is ready');assert.equal(body.classes.size,0);
 root.children[0].emit('load');assert.equal(body.classes.has('freedraw-pdf-scroll-preview-hidden'),true);
 cache.hideAll();assert.equal(body.classes.size,0,'Idle must restore the original SVG');
 cache.show(root);cache.invalidate(root);assert.equal(body.classes.size,0,'Edits must restore SVG immediately');assert.equal(disposed,1);
 const r2=new Node(),r3=new Node(),r4=new Node();for(const r of [r2,r3,r4])await cache.prepare(r,new Node(),1000,1400,()=>true);
 assert.equal(disposed,2,'Evict beyond the shared page/memory budget');cache.clear();assert.equal(disposed,4);
 let finish;const pending=new ScrollPreviewCache(()=>new Promise(resolve=>finish=resolve)),r5=new Node(),b5=new Node();
 const task=pending.prepare(r5,b5,1000,1400,()=>true);pending.invalidate(r5);finish({href:'blob:old',width:1,height:1,bytes:4,dispose(){disposed++;}});
 assert.equal(await task,false,'An edit must reject an in-flight stale snapshot');assert.equal(pending.show(r5),false);assert.equal(disposed,5);
 const failure=new ScrollPreviewCache(async()=>{throw new Error('decode');});assert.equal(await failure.prepare(new Node(),new Node(),1,1,()=>true),false,'Decode errors retain SVG');
 const loadError=new ScrollPreviewCache(factory),r6=new Node(),b6=new Node();await loadError.prepare(r6,b6,1,1,()=>true);r6.children[0].emit('load');loadError.show(r6);r6.children[0].emit('error');assert.equal(b6.classes.size,0,'Image failures must restore SVG');
 let stillIdle=true,finish2;const race=new ScrollPreviewCache(()=>new Promise(resolve=>finish2=resolve));const raced=race.prepare(new Node(),new Node(),1,1,()=>stillIdle);stillIdle=false;finish2({href:'blob:race',width:1,height:1,bytes:4,dispose(){disposed++;}});assert.equal(await raced,false,'Input starting during conversion must reject the result');
 const {SvgAnnotationRenderer}=loadSource('src/render/svgDrawingContext.ts');
 const renderer=new SvgAnnotationRenderer();renderer.scrollPreviews=new ScrollPreviewCache(factory);
 const r7=new Node();const frame=renderer.create(r7,1000,1400);
 for(let i=0;i<80;i++){frame.setKey('stroke:'+i);frame.beginPath();frame.moveTo(i,i);frame.lineTo(i+1,i+1);frame.stroke();}
 renderer.publish(frame);assert.equal(await renderer.prepareMotionPreview(r7,()=>true),true);
 const image=r7.children.find(n=>n.attrs.href);image.emit('load');assert.equal(renderer.showMotionPreview(r7),true);
 assert.equal(r7.children.indexOf(image),1,'Cached image must sit below the live SVG layer');
 renderer.promote(r7);assert.equal(renderer.showMotionPreview(r7),false,'Committing new ink must invalidate the old picture');
 await renderer.prepareMotionPreview(r7,()=>true);renderer.erase(r7,1000,1400,{x:.1,y:.1},{x:.2,y:.2},8);
 assert.equal(renderer.showMotionPreview(r7),false,'Erasing must invalidate the old picture');renderer.release(r7);
 const mainSource=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../main.ts'),'utf8');
 assert.ok(mainSource.includes('this.svgRenderer?.hideMotionPreviews?.();\n\t\tconst isInkInput'),'Every admitted tool restores SVG before input');
 assert.ok(mainSource.includes('}, 1200);'),'Build previews after idle, never at scroll start');
 assert.ok(built>=4);console.log('Scroll preview cache passed: ready-before-hide, idle/input restoration, edit/load failures, stale async results, eviction and disposal.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
