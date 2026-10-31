const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{loadSource}=require('./load-source');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NativePdfAnnotatorSession');
const {TOOL_WIDTH_RANGES}=loadSource('src/config.ts');
class Element {
 constructor(cls=''){this.className=cls;this.children=[];this.listeners=new Map();this.classList={add(){}}}
 createDiv(options={}){return this.add(new Element(options.cls))}createSpan(options={}){return this.add(new Element(options.cls))}createEl(){return this.add(new Element())}
 add(element){this.children.push(element);return element}appendChild(element){return this.add(element)}setCssProps(){}setCssStyles(){}
 addEventListener(name,fn){this.listeners.set(name,fn)}emit(name){this.listeners.get(name)?.()}
}
const context={createDiv:()=>new Element()};
vm.runInNewContext(ts.transpileModule('class Session{'+cls.members.find(n=>n.name?.getText(ast)==='openStrokeThicknessPopover').getText(ast)+'}globalThis.Session=Session;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
const all=e=>[e,...e.children.flatMap(all)];
for(const [tool,min,max,step] of [['pen',1,48,.5],['highlighter',4,64,.5],['eraser',4,80,1]])for(const selected of [false,true]){
 const updates=[];let popup,history=0;
 const s=Object.assign(new context.Session(),{currentTool:tool,currentColor:'#55b4ff',beginExclusiveMenu(){},shouldApplyStyleToSelection:()=>selected,getSelectionWidthValue:()=>18,getActiveWidth:()=>18,getStrokePopoverTitle:()=>tool,createPopoverCloseButton:()=>new Element(),getWidthRange:()=>TOOL_WIDTH_RANGES[tool],pushHistory:()=>history++,setToolbarWidth:(...args)=>updates.push(args),updateStrokePreviewElement(){},positionPopoverNearAnchor(){},transientPopovers:{open(key,element,options){assert.equal(key,'stroke');assert.equal(options,undefined,'Original slider needs no custom input cleanup');popup=element}}});
 s.openStrokeThicknessPopover({});const slider=all(popup).find(e=>e.min!==undefined);
 assert.equal(slider.min,String(min));assert.equal(slider.max,String(max));assert.equal(slider.step,String(step));assert.equal(slider.value,'18');
 assert.deepEqual([...slider.listeners.keys()],['input','change'],'Keep native pointer and keyboard interactions');
 slider.value=String(min+step);slider.emit('input');slider.value=String(min+2*step);slider.emit('input');slider.emit('change');
 assert.equal(history,selected?1:0,'Capture selected-width undo history once');
 assert.equal(updates.length,3);assert.deepEqual(updates[2],[min+2*step,true,tool,!selected]);
 console.log('PASS 0.13.6 '+tool+' thickness range, steps, native events and '+(selected?'selection':'tool')+' updates');
}
assert.ok(!source.includes('bindContinuousWidthSlider'),'Remove experimental slider handling');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8'),button=css.match(/^\.pdf-native-annotator-stroke-button \{[^}]*\}/m)[0];
assert.ok(button.includes('min-width: 52px'));assert.ok(!button.includes('width: 64px'));assert.ok(button.includes('padding: 0 12px'));
console.log('PASS numeric thickness button has modest extra horizontal space');
