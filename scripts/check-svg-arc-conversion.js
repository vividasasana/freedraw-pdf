// Preserve exact legacy SVG output while bounding redundant arc conversion work.
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),ts=require("typescript"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{loadSource}=require("./load-source");
const file=path.join(__dirname,"../src/render/svgDrawingContext.ts"),m={exports:{}},count={sin:0,cos:0},math=Object.create(Math);
math.sin=x=>{count.sin++;return Math.sin(x)};math.cos=x=>{count.cos++;return Math.cos(x)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,Math:math,require:id=>loadSource(path.resolve(path.dirname(file),id+".ts"))});
class Node {constructor(){this.attrs={};this.ownerDocument={defaultView:{createFragment:()=>({createSvg:(tag,options)=>({tag,attrs:options.attr})})}}}}
const frame=()=>new m.exports.SvgDrawingContext(new Node(),1000,1400,new WeakMap());
const probe=frame();probe.beginPath();probe.ellipse(10,20,3,7,0,.3,1.4);probe.fill();
const trig=count.sin+count.cos,hash=crypto.createHash("sha256");
for(let i=0;i<350;i++){const ctx=frame(),rotation=[0,.4,-.7][i%3],start=i*.031-4,end=start+[.03,Math.PI,Math.PI*2,-.4,Math.PI*3][i%5];ctx.beginPath();ctx.ellipse(i*.17,-i*.06,1+i%17,.3+i%11,rotation,start,end,i%2===0);ctx.fill();hash.update(ctx.records[0].node.attrs.d+"\n")}
const digest=hash.digest("hex");
if(process.argv.includes("--record-baseline")){console.log(JSON.stringify({trig,digest}));process.exit(0)}
assert.ok(trig<=6,"An unrotated arc should not repeatedly recalculate fixed rotation; baseline used "+trig+" trig calls");
assert.equal(digest,"2fd7446a65f70b469946587aca4e007c76a4f085a72a9f7b771e990f325df76c","Arc optimisation must preserve existing quantised SVG coordinates and sweep flags");
console.log("SVG arc conversion passed: fixed trig budget, 350 legacy path cases including rotated/negative/full arcs, exact SVG output.");

