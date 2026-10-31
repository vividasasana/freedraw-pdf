const assert = require('node:assert/strict');
const {loadSource} = require('./load-source');
const {syncReadOnlyTextLayer} = loadSource('src/text/readOnlyLayer.ts');
class Element {
 constructor(){this.children=[];this.dataset={};this.style={};this.classList={add(){}};this.ownerDocument={createElement:()=>({getContext:()=>({save(){},restore(){},measureText:text=>({width:text.length*10})})})};}
 querySelector(){return this.children[0]??null;}
 createDiv(options){const e=new Element();e.textContent=options?.text??'';this.children.push(e);return e;}
 createSpan(options){return this.createDiv(options);}
 setCssStyles(value){Object.assign(this.style,value);} setCssProps(value){Object.assign(this.style,value);} setAttribute(){} addEventListener(){}
 replaceChildren(){this.children=[];} remove(){this.removed=true;}
}
const host=new Element(),items=[{id:'typed',page:1,text:'Select this text',x:.1,y:.2,fontSize:20,fontScale:.02,boxWidthScale:.5,boxHeightScale:.1,fontFamily:'Arial',verticalAlign:'top'}];
syncReadOnlyTextLayer(host,items,1000,1400,false);
assert.ok(host.children[0],'read mode must mount native selectable typed text');
assert.equal(host.children[0].children.map(n=>n.textContent).join(''),'Select this text');
const layer=host.children[0];syncReadOnlyTextLayer(host,items,1500,2100,false);assert.equal(host.children[0],layer,'zoom should retain the selection surface');
syncReadOnlyTextLayer(host,items,1500,2100,true);assert.equal(layer.removed,true,'annotation mode keeps editing/moving gestures');
console.log('Read-only text layer passed: typed content, read-mode selection, zoom reuse and annotation-mode handoff.');
