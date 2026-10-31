const assert=require("node:assert/strict"),fs=require("node:fs"),{loadSource}=require("./load-source");
const model=loadSource("src/ocr/model.ts"),layout=loadSource("src/ocr/layout.ts");
const stroke=(id,page=1)=>({id,page,tool:"pen",color:"#6c3db5",width:3,widthScale:.003,points:[{x:.2,y:.3,pressure:.5},{x:.7,y:.4,pressure:.5}]});
const a=stroke("a"),b=stroke("b",2),group=(id,source,text,mode)=>({id,page:source.page,strokeIds:[source.id],sourceFingerprint:model.ocrFingerprint(model.ocrSourceSnapshot([source])),text,lines:[{text,box:{left:.2,top:.3,right:.7,bottom:.4}}],mode,provider:"fixture",createdAt:"fixture"});
const doc={strokes:[a,b],shapes:[],textItems:[],ocrGroups:[group("ink",a,"HELLO β","ink"),group("text",b,"早安","text")]};
const stack=[];const original=JSON.stringify(doc),painted=[],ctx={font:"old font",measureText:text=>({width:Array.from(text).length*600,actualBoundingBoxAscent:750,actualBoundingBoxDescent:100}),save(){stack.push(this.font)},restore(){this.font=stack.pop()},translate(){},scale(){},fillText:text=>painted.push(text)};
assert.equal(model.getOcrPageView(doc,1).groups.length,0);assert.equal(model.getOcrPageView(doc,1).hiddenStrokeIds.size,0);
assert.deepEqual(layout.selectableOcrTextRuns(ctx,doc,1,1000,1400).map(run=>run.text),["HELLO β"],"Ink-mode PDF exports must include their accepted text without hiding handwriting");
assert.deepEqual(layout.selectableOcrTextRuns(ctx,doc,2,1000,1400).map(run=>run.text),["早安"]);
layout.renderOcrText(ctx,doc,1,1000,1400);assert.equal(painted.length,0,"Export must not paint recognised typeset text over ink");
layout.renderOcrText(ctx,doc,2,1000,1400);assert.deepEqual(painted,["早安"]);assert.equal(JSON.stringify(doc),original,"Export projection must not mutate source ink, mode or text");assert.equal(ctx.font,"old font");
for(const kind of ["changed","deleted","moved","highlighter"]){const stale=JSON.parse(original);if(kind==="changed")stale.strokes[0].points[0].x+=.01;if(kind==="deleted")stale.strokes.shift();if(kind==="moved")stale.strokes[0].page=2;if(kind==="highlighter")stale.strokes[0].tool="highlighter";assert.equal(layout.selectableOcrTextRuns(ctx,stale,1,1000,1400).length,0,"Do not export "+kind+" OCR source")}
console.log("Ink-preserving OCR export projection passed: accepted ink/text groups, unchanged handwriting appearance, Unicode, source preservation and stale-source rejection.");

