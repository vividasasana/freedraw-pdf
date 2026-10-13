const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'main.ts'),'utf8');
const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const sessionClass=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const method={getText:()=>sessionClass.members.filter(n=>["getQuickAddPageOptions","recordLatestPageStyle"].includes(n.name?.getText(tree))).map(n=>n.getText(tree)).join("\n")};
const context={};vm.runInNewContext(ts.transpileModule(`class Session {${method.getText(tree)}} globalThis.Session=Session;`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
const session=new context.Session();
let settings={source:'previous',template:'grid',paperColor:'#abc123'},pages=[],current=null;
Object.assign(session,{plugin:{getQuickAddPageSettings:()=>({...settings})},getAppendedPages:()=>pages,getCurrentSyntheticPage:()=>current,
getNativeInsertPageDefaults:()=>({title:'New page',pageSize:'a4',template:'ruled',paperColor:'#fffdf7'})});
const options=index=>JSON.parse(JSON.stringify(session.getQuickAddPageOptions({anchor:3,insertIndex:index,anchorLabel:'PDF 3'})));
assert.equal(options(0).template,'grid','No previous temporary page must fall back to configured template');
assert.equal(options(0).paperColor,'#abc123');

pages=[{template:'grid',paperColor:'#ffff00',pageSize:'a4'}];
assert.equal(options(1).template,'grid');assert.equal(options(1).paperColor,'#ffff00');
session.annotationDocument={};
session.recordLatestPageStyle({template:'dot',paperColor:'#ffcc00',pageSize:'letter'});
assert.equal(options(2).template,'dot','Explicitly creating or restyling a page establishes the next style');
assert.equal(options(2).paperColor,'#ffcc00');
session.recordLatestPageStyle({template:'grid',paperColor:'#0000ff',pageSize:'a4'});
current={template:'ruled',paperColor:'#abcdef'};
assert.equal(options(0).paperColor,'#0000ff','Changing an earlier page must win over current page or insertion position');
assert.equal(options(5).paperColor,'#0000ff');
session.annotationDocument=JSON.parse(JSON.stringify(session.annotationDocument));
assert.equal(options(5).paperColor,'#0000ff','Latest style must survive a saved document roundtrip');
settings.source='defaults';assert.equal(options(5).paperColor,'#0000ff','Legacy inheritance mode must not override the automatic rule');
pages=[];current=null;session.annotationDocument={nativePageTemplatesEditable:true,pdfPageTemplates:[{template:'blank',paperColor:'#112233',pageSize:'letter'}]};
assert.equal(options(0).paperColor,'#112233','Plugin-created PDFs seed added pages from their original paper style');
assert.equal(options(0).pageSize,'letter');
session.annotationDocument={};assert.equal(options(0).template,'grid','A separate PDF starts with configured defaults');
assert.equal(options(0).paperColor,'#abc123');
assert.ok(source.includes('const quickDefaults = this.getQuickAddPageOptions(afterLocation);'),'Page menu must use the new style resolver');
console.log('Quick add passed: previous-page template/colour, configured defaults, no-previous fallback and PDF isolation.');

for(const setter of ['setPdfPageTemplateByPage','setPdfPagePaperColorByPage','setCurrentTemplatePageTemplate','setAddedPageTemplateById','setAddedPagePaperColorById','setCurrentTemplatePageColorValue']) {
 const node=sessionClass.members.find(n=>n.name?.getText(tree)===setter);
 assert.ok(node.getText(tree).includes('recordLatestPageStyle('),setter+' must update the latest style even for an earlier page');
}
