const assert=require('node:assert/strict'),{loadSource}=require('./load-source');
const {constrainShape,isDrawingModifierHeld}=loadSource('src/shapes/constraints.ts'),{ToolStateController}=loadSource('src/tools/toolState.ts'),{DEFAULT_TOOL_PRESETS}=loadSource('src/config.ts');
const base={id:'shape',page:1,tool:'rectangle',color:'#000000',width:3,start:{x:.2,y:.2,pressure:.5},end:{x:.7,y:.5,pressure:.5},createdAt:'fixture'};
for(const aspect of [.7,1,1.414,2])for(const tool of ['ellipse','rectangle']){
 const shape=constrainShape({...base,tool},aspect);assert.ok(Math.abs(shape.end.x-shape.start.x-(shape.end.y-shape.start.y)*aspect)<1e-10,'Circle/square must use physical page aspect');
}
for(const aspect of [1,1.414,2])for(const constraint of ['regular','right']){
 const s=constrainShape({...base,tool:'triangle',vertices:[{x:.5,y:0},{x:1,y:1},{x:0,y:1}]},aspect,constraint);
 const v=s.vertices.map(p=>({x:s.start.x+p.x*(s.end.x-s.start.x),y:(s.start.y+p.y*(s.end.y-s.start.y))*aspect}));
 const lengths=v.map((p,i)=>Math.hypot(p.x-v[(i+1)%3].x,p.y-v[(i+1)%3].y)).sort((a,b)=>a-b);
 if(constraint==='regular')assert.ok(lengths[2]-lengths[0]<1e-10,'Triangle must have equal sides');
 else assert.ok(Math.abs(lengths[0]**2+lengths[1]**2-lengths[2]**2)<1e-10,'Right triangle must have a 90-degree corner');
}
assert.equal(isDrawingModifierHeld({shiftKey:true},'shift'),true);assert.equal(isDrawingModifierHeld({shiftKey:true},'none'),false);assert.equal(isDrawingModifierHeld({altKey:true},'alt'),true);
for(const kind of ['pen','highlighter']){
 const state=new ToolStateController(DEFAULT_TOOL_PRESETS);state.setActiveTool(kind);state.setInkToolOptions(kind,{...state.getInkToolOptions(kind),mode:'freehand',lineStyle:'wavy'});
 const before=JSON.stringify(state.snapshot),temporary=state.getInkShapeOptions(kind,true);assert.equal(temporary.shape,'line');assert.equal(temporary.lineStyle,'solid');assert.equal(temporary.appearance,kind);
 assert.equal(state.getInkShapeOptions(kind,false),null);assert.equal(JSON.stringify(state.snapshot),before,'Temporary modifier must not change saved mode/style');
}
console.log('Shape constraints passed: page-correct circles/squares, equilateral/right triangles, modifier selection and temporary solid lines for both ink tools.');
