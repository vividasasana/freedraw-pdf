const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const method=cls.members.find(n=>n.name?.getText(tree)==='isExternalPdfMutation').getText(tree),ctx={isDomNode:()=>true,isDomElement:()=>false};
vm.runInNewContext(ts.transpileModule('class Session{'+method+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const s=new ctx.Session(),owned={},removed={},native={};s.isOwnedAnnotatorDom=node=>node===owned;
assert.equal(s.isExternalPdfMutation({type:'childList',target:owned,addedNodes:[],removedNodes:[removed]}),false,'Removing owned SVG paths/images must not schedule native PDF layout');
assert.equal(s.isExternalPdfMutation({type:'childList',target:native,addedNodes:[{}],removedNodes:[]}),true,'Real native PDF page changes still require layout sync');
console.log('Owned SVG mutations do not trigger native PDF layout; native page changes still do.');

assert.ok(source.includes('[data-freedraw-layer]'),'Detached annotation layers must retain ownership markers');
