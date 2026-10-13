const {loadSource}=require('../scripts/load-source');const assert=require('node:assert/strict');
const {SvgDrawingContext}=loadSource('src/render/svgDrawingContext.ts');
const root={ownerDocument:{defaultView:{createFragment:()=>({createSvg:(_tag,o)=>({attrs:o.attr})})}}};
const svg=new SvgDrawingContext(root,1000,1400,new WeakMap());svg.beginPath();svg.moveTo(.123456789,.987654321);
for(let i=0;i<100;i++)svg.lineTo(i+Math.sin(i)*.1,i+Math.cos(i)*.1);svg.fill();
const d=svg.records[0].node.attrs.d;console.log({pathBytes:d.length});
assert.ok(!/\d+\.\d{4}/.test(d),'SVG display coordinates must not carry redundant floating-point digits');

const numeric=d.split(/\s+/).map(Number).filter(Number.isFinite);
assert.ok(d.length<2000,'Displayed SVG paths should be substantially smaller');
assert.ok(d.includes('0.123 0.988'),'Display rounding must preserve subpixel coordinates');
console.log('SVG serialization keeps subpixel precision while reducing path bytes.');
