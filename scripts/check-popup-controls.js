const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
class Button{constructor(){this.events=new Map();this.attrs={}}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){this.events.set(k,fn)}emit(k){this.events.get(k)?.({preventDefault(){},stopPropagation(){}})}}
const context={createEl:()=>new Button(),setIcon(){}};
vm.runInNewContext(ts.transpileModule('class Session{'+cls.members.find(n=>n.name?.getText(ast)==='createPopoverCloseButton').getText(ast)+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
let failures=0;function check(name,fn){try{fn();console.log('PASS '+name)}catch(e){failures++;console.error('FAIL '+name+': '+e.message)}}
check('Close button waits for activation, allowing press feedback and pointer cancellation',()=>{
 let closed=0;const button=new context.Session().createPopoverCloseButton(()=>closed++);
 assert.equal(button.type,'button');assert.equal(button.attrs['aria-label'],'Close');
 assert.ok(button.className.split(' ').includes('clickable-icon'),'Close must opt out of native raised text-button styling');
 button.emit('pointerdown');assert.equal(closed,0,'Do not dismiss before a pressed frame can be shown');
 button.emit('pointercancel');assert.equal(closed,0);button.emit('click');assert.equal(closed,1);
 button.emit('click');assert.equal(closed,2,'Keyboard-generated button clicks must dismiss too');
});
check('Close feedback survives the generic transparent-button rule',()=>{
 const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.ok(css.includes(':not(.pdf-native-annotator-popover-close)'),'Exclude close buttons from blanket transparency');
 assert.ok(css.includes('.pdf-native-annotator-popover-close:active'),'Pressed feedback must cover custom popovers');
 assert.ok(css.includes('.pdf-native-annotator-dialog .modal-close-button'),'Native plugin dialogs share the same close styling');
 assert.ok(css.includes('.pdf-native-annotator-dialog .modal-header-button:active'),'Current native header buttons also get pressed feedback');
});
check('Menus retain native dropdowns and compact close feedback',()=>{
 const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.ok(!/select\.dropdown[^{]*\{[^}]*appearance:\s*auto/s.test(css),'Do not replace the native paired-chevron select appearance');
 assert.ok(!/select\.dropdown:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--interactive-accent\)/s.test(css),'Use native keyboard focus instead of an accent outline box');
 assert.ok(!/\.pdf-native-annotator-(?:font|case)-select\s*\{[^}]*\bfont:\s*var\(--font-ui-small\)/s.test(css),'Select typography must not reset the native font size through an invalid shorthand');
 assert.ok(!/popover-close:is\(:hover, :focus-visible\)/.test(css),'Focus is not a persistent hover background');
 assert.ok(!/popover-close:hover,\s*\.pdf-native-annotator-popover-close:focus-visible/.test(css),'Separate keyboard focus from grey hover');
 const shared=css.slice(css.indexOf('/* Shared headers and close feedback'));
 assert.ok(!/width:\s*30px|height:\s*30px/.test(shared),'Use the compact native close dimensions');
});
process.exitCode=failures?1:0;
