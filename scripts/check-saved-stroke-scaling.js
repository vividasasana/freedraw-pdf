const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const method=cls.members.find(n=>n.name?.getText(tree)==='getStrokePathSignature').getText(tree);
const shim={};vm.runInNewContext(ts.transpileModule('class Session { private strokePointHashCache = new WeakMap(); '+method+' }globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,shim);
let reads=0;const make=()=>({points:new Proxy(Array.from({length:160},(_,i)=>({x:i/180,y:Math.sin(i/12)/8+.5,pressure:.5})),{get(t,k){if(/^\d+$/.test(String(k)))reads++;return Reflect.get(t,k);}}),inkSettings:{thinning:.35}});
for(const count of [10,100,1000]){const session=new shim.Session(),strokes=Array.from({length:count},make),surface={lastWidth:1000,lastHeight:1400};for(const s of strokes)session.getStrokePathSignature(surface,s,8,true);reads=0;for(const s of strokes)session.getStrokePathSignature(surface,s,8,true);console.log({savedStrokes:count,repeatedPointReads:reads});if(count===1000)assert.ok(reads<=count*2,'Unchanged saved strokes must not rehash every point on repeated redraws');}

const session=new shim.Session(),surface={lastWidth:1000,lastHeight:1400},stroke=make();
const initial=session.getStrokePathSignature(surface,stroke,8,true);
stroke.points=stroke.points.map((p,i)=>({...p,x:p.x+(i===80?0.02:0)}));
assert.notEqual(session.getStrokePathSignature(surface,stroke,8,true),initial,'Moving geometry must invalidate its hash');
const moved=session.getStrokePathSignature(surface,stroke,8,true);
assert.notEqual(session.getStrokePathSignature(surface,stroke,12,true),moved,'Width edits must invalidate the path signature');
stroke.inkSettings.thinning=.8;
assert.notEqual(session.getStrokePathSignature(surface,stroke,8,true),moved,'Ink settings edits must invalidate the path signature');
