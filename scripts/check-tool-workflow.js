const fs = require('node:fs'), assert = require('node:assert/strict'), ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
try {
 const { ToolStateController } = require('../src/tools/toolState.ts');
 const { DEFAULT_TOOL_PRESETS } = require('../src/config.ts');
 const { toolCommandDefinitions } = require('../src/commands/toolCommands.ts');
 const state = new ToolStateController(DEFAULT_TOOL_PRESETS, { shapeOptions: { method: 'drag', shape: 'triangle', appearance: 'highlighter' }, inkToolOptions: { pen: { mode: 'hold', holdShape: 'line' } } });
 state.setActiveTool('triangle');
 assert.equal(new ToolStateController(DEFAULT_TOOL_PRESETS).shapeOptions.method,'hold','Fresh Shapes keeps draw-and-hold by default');
 assert.equal(state.shapeOptions.method, 'drag', 'Saved drag-to-size choice must be available');
 assert.equal(state.shapeOptions.shape,'triangle');
 state.setShapeOptions({...state.shapeOptions,method:'hold'});assert.equal(state.shapeOptions.shape,'auto');state.setShapeOptions({...state.shapeOptions,method:'drag'});assert.equal(state.shapeOptions.shape,'triangle','Switching back must remember the drag shape');
 assert.equal(state.shapeOptions.appearance, 'pen', 'Shapes must not use highlighter appearance');
 assert.equal(state.getInkToolOptions('pen').mode, 'freehand', 'Old per-pen hold preference must migrate to freehand');
 for (const kind of ['pen', 'highlighter']) {
  state.setActiveTool(kind);
  const settings = { ...state.getInkToolOptions(kind), mode: 'straight', lineStyle: 'wavy' };
  state.setInkToolOptions(kind, settings);
  assert.equal(state.getInkShapeOptions(kind).shape, 'line');
  assert.equal(state.getInkShapeOptions(kind).lineStyle, 'wavy');
 }
 const commands = toolCommandDefinitions();
 const { contextualToolControls } = require('../src/ui/contextualToolControls.ts');
 const controls = tool => contextualToolControls(tool, tool==='pen'||tool==='highlighter'?state.getInkToolOptions(tool):undefined, state.shapeOptions, {
  ink:(kind,patch)=>state.setInkToolOptions(kind,{...state.getInkToolOptions(kind),...patch}),
  shape:patch=>state.setShapeOptions({...state.shapeOptions,...patch})
 });
 state.setInkToolOptions('pen',{...state.getInkToolOptions('pen'),mode:'freehand'});
 assert.deepEqual(controls('pen').map(c=>c.label),['Freehand']);
 controls('pen')[0].run();assert.equal(state.getInkToolOptions('pen').mode,'straight');
 assert.equal(state.getInkToolOptions('highlighter').mode,'straight','Pen quick control must not alter Highlighter');
 assert.deepEqual(controls('pen').map(c=>c.id),['drawing-mode','line-style','wave-size']);
 controls('pen').find(c=>c.id==='wave-size').run();assert.equal(state.getInkToolOptions('pen').waveSize,2);
 controls('pen').find(c=>c.id==='line-style').run();assert.equal(state.getInkToolOptions('pen').lineStyle,'solid');
 state.setShapeOptions({...state.shapeOptions,method:'hold'});assert.deepEqual(controls('line').map(c=>c.label),['Draw and hold']);
 controls('line')[0].run();assert.equal(state.shapeOptions.method,'drag');
 controls('triangle').find(c=>c.id==='shape-type').run();assert.equal(state.shapeOptions.shape,'line');
 assert.ok(controls('line').some(c=>c.id==='line-style'));assert.deepEqual(controls('text'),[]);
 const { inkToolMenuItems, inkWaveSizeMenuItems } = require('../src/ui/inkToolMenu.ts');
 let menuOptions={...state.getInkToolOptions('pen'),mode:'freehand',lineStyle:'solid'},waveMenuOpened=0;
 const menuItems=()=>inkToolMenuItems(menuOptions,patch=>{menuOptions={...menuOptions,...patch}},()=>waveMenuOpened++);
 assert.deepEqual(menuItems().map(item=>item.title),['Freehand','Straight line']);assert.equal(menuItems()[0].checked,true);
 menuItems()[1].run();assert.equal(menuOptions.mode,'straight');
 assert.equal(menuItems().filter(item=>item.checked).length,2,'Mode and line style must each have a checked choice');
 menuItems().find(item=>item.title==='Wavy').run();assert.equal(menuOptions.lineStyle,'wavy');menuItems().find(item=>item.title?.startsWith('Wave size:')).run();assert.equal(waveMenuOpened,1);
 const sizes=inkWaveSizeMenuItems(1.5,size=>{menuOptions.waveSize=size});assert.equal(sizes.length,24);assert.deepEqual(sizes.filter(item=>item.checked).map(item=>item.title),['1.5']);sizes.at(-1).run();assert.equal(menuOptions.waveSize,6);sizes[0].run();assert.equal(menuOptions.waveSize,.25);
 menuItems().find(item=>item.title==='Freehand').run();assert.deepEqual(menuItems().map(item=>item.title),['Freehand','Straight line']);assert.equal(menuOptions.lineStyle,'wavy','Changing mode must retain the remembered line style');
 state.setShapeOptions({...state.shapeOptions,method:'drag',shape:'line',lineStyle:'dotted'});
 const session={configureShapeTool:options=>state.setShapeOptions({...state.shapeOptions,...options})};
 commands.find(command=>command.id==='shape-method-hold').run(session);
 commands.find(command=>command.id==='shape-method-drag').run(session);
 assert.equal(state.shapeOptions.lineStyle,'dotted','Method commands must preserve the remembered drag line style');
 assert.equal(state.shapeOptions.shape,'line');
 assert.ok(commands.some(command => command.id === 'shape-method-hold'));
 assert.ok(commands.some(command=>command.id==='shape-method-drag'));for(const tool of ['line','rectangle','ellipse','triangle'])assert.ok(commands.some(command=>command.id==='shape-drag-'+tool));assert.ok(!commands.some(command=>command.id.startsWith('shape-appearance')));
 assert.ok(!commands.some(command => /^tool-(pen|highlighter)-hold$/.test(command.id)));
 const css = fs.readFileSync('styles.css', 'utf8');
 assert.ok(!/annotation-toggle\s*\{[^}]*width:\s*80px/s.test(css), 'Text buttons must size to their labels');
 console.log('Tool workflow passed: auto hold Shapes, pen-only appearance, legacy preferences migrated, distinct ink modes and command inventory.');
} finally { require.extensions['.ts'] = previous; }
