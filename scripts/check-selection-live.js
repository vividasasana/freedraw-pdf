const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../main.ts'),'utf8'),ast=ts.createSourceFile('m.ts',source,99,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const names=['handlePointerMoveForCanvas','getPageFrameKey','invalidateAnnotationPageCache'];const methods=names.map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast)).join('\n');
for(const regression of [true,false]){
 const code=regression?methods.replace('this.invalidateAnnotationPageCache(pageNumber);',''):methods,ctx={isInkDrawingTool:()=>false};vm.runInNewContext(ts.transpileModule('class S{'+code+'}globalThis.S=S;', {compilerOptions:{target:7}}).outputText,ctx);
 const surface={pageNumber:1,overlayEl:{},vectorEl:{}},s=Object.assign(new ctx.S(),{currentTool:'select',pointerPage:1,pageSurfaces:new Map([[1,surface]]),selectedTarget:{kind:'stroke',id:'a',page:1},selectedTargets:[{kind:'stroke',id:'a',page:1}],dragAnchor:{x:.2,y:.2},annotationDocument:{strokes:[]},getNormalizedPoints:()=>[{x:.3,y:.4}],moveSelectedTargetsWithinPage(){},scheduleInteractionRedraw(){},publishedFrames:new WeakMap(),annotationPageRevisions:new Map(),ownerWindow:{devicePixelRatio:1}});
 const before=s.getPageFrameKey(surface);s.handlePointerMoveForCanvas({preventDefault(){}},{dataset:{pageNumber:'1'}});const changed=s.getPageFrameKey(surface)!==before;
 assert.equal(changed,!regression);console.log(regression?'REPRODUCED old bug: moved selection reuses stale SVG frame':'PASS fixed selection: moved coordinates invalidate SVG frame before repaint');
}
