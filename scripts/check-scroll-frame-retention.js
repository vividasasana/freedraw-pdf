const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const methods=['getPageFrameKey','invalidateAnnotationPageCache'].map(name=>cls.members.find(n=>n.name?.getText(tree)===name).getText(tree)).join('\n');
const ctx={};vm.runInNewContext(ts.transpileModule('class Session{'+methods+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const s=new ctx.Session();Object.assign(s,{documentRevision:1,renderRevision:0,annotationPageRevisions:new Map(),publishedFrames:new WeakMap(),strokePathCache:new Map(),annotationDocument:{strokes:[]},selectedTargets:[],ownerWindow:{devicePixelRatio:2}});
const surface={pageNumber:2,vectorEl:{},overlayEl:{}};const before=s.getPageFrameKey(surface);s.publishedFrames.set(surface.overlayEl,before);
s.invalidateAnnotationPageCache(1);s.documentRevision++;
assert.equal(s.publishedFrames.get(surface.overlayEl),before,'Adding ink on one page must retain other pages\' existing frame records');
assert.equal(s.getPageFrameKey(surface),before,'Adding ink elsewhere must not force unchanged pages to redraw after scrolling');
console.log('Unchanged page frames survive an ink commit on a different page.');

s.invalidateAnnotationPageCache();
assert.notEqual(s.getPageFrameKey(surface),before,'General edits must invalidate stale frames');
assert.equal(s.publishedFrames.get(surface.overlayEl),undefined,'General edits must discard previous frame records');
assert.ok(source.includes('if (committedPreviewStroke && canRetainCommittedFrame && committedSurface) this.publishedFrames.set'),'Only a complete preceding frame may be marked current after appending ink');
