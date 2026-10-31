const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const {loadSource} = require('./load-source');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,'main.ts'),'utf8');
const tree = ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const sessionClass = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NativePdfAnnotatorSession');
const methods = ['refreshToolbar','restoreToolbarToolScroll','setSelectionMode'].map(name => sessionClass.members.find(n => n.name?.getText(tree) === name).getText(tree)).join('\n');
const compiled = ts.transpileModule(`class Session { ${methods} } globalThis.Session=Session;`, {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
class Element {
  constructor(){this.children=[];this.dataset={};this.className='';this.scrollLeft=0;this.scrollTop=0;this.isConnected=true;this.classList={add:(...names)=>this.className+=' '+names.join(' '),toggle:()=>{},remove:()=>{},contains:name=>this.className.split(' ').includes(name)};}
  appendChild(child){this.children.push(child);return child;} replaceChildren(){this.children=[];} setAttribute(){} setCssProps(){}
  querySelector(selector){const name=selector.includes('is-tool-options')?'is-tool-options':selector.includes('is-actions')?'is-actions':'is-tools';return this.children.find(n=>n.className.split(' ').includes(name));}
}
function setup(Session,makeElement){
  const s=new Session(),button=(label,action,icon=false)=>{const b=makeElement('button');b.textContent=icon?'●':label;b.title=label;b.type='button';b.activate=action;b.className='pdf-native-annotator-button'+(icon?' pdf-native-annotator-icon-button':' pdf-native-annotator-text-button');if(b.addEventListener&&action)b.addEventListener('click',action);return b;};
  Object.assign(s,{annotationMode:true,currentTool:'pen',separate:true,rootEl:makeElement('div'),toolbarEl:makeElement('div'),selectedTargets:[],lastSelectionRegion:null,eraserMode:'object',toolbarScrollRestoreHandle:null,
    ownerWindow:{requestAnimationFrame:f=>{f();return 1;},cancelAnimationFrame(){}},
    plugin:{shouldSeparateToolOptions:()=>s.separate,shouldShowRegionToolbarButton:()=>true,shouldShowCopyEmbedToolbarButton:()=>false,hasClipboard:()=>false},
    toolState:{selectionMode:'single',setSelectionMode(mode){this.selectionMode=mode;},shapeOptions:{shape:'line'},getInkToolOptions:()=>({mode:'freehand',lineStyle:'solid'}),getPresetsByKind:()=>['Preset 1','Preset 2','Preset 3']},
    createButton:(label,_active,action)=>button(label,action), createIconButton:(_icon,label,_active,action)=>button(label,action,true),createHistoryIconButton:(_icon,label)=>button(label,undefined,true),
    createPageMenuButton:()=>button('Page'),createPresetButton:p=>button(p),createColorPickerButton:()=>button('Colour'),createStrokeSizeButton:()=>button('Width'),
    getActivePresetKind:()=>['pen','highlighter'].includes(s.currentTool)?s.currentTool:null,isStrokeSizedTool:()=>!['text','select','region'].includes(s.currentTool),shouldApplyStyleToSelection:()=>false,hasSelectedText:()=>false,
    setActiveTool:tool=>{s.currentTool=tool;},toggleAnnotationMode:()=>{s.annotationMode=!s.annotationMode;s.refreshToolbar();},getInkInputPolicy:()=> 'pen-mouse-only',
    persistToolDefaults(){},drawAllAnnotations(){},updateNativeMixedPageThumbnailSelection(){},syncNativeMixedPageNavigator(){},repositionOpenPopovers(){},applyOverlayMode(){},refreshStatus(){},
    openInkToolOptions:(_button,kind)=>{s.opened=kind;},toggleEraserMode:()=>{s.eraserMode=s.eraserMode==='object'?'segment':'object';s.refreshToolbar();},openShapeToolMenu:()=>{s.currentTool='line';s.refreshToolbar();}
  });return s;
}
const globals={contextualToolControls:loadSource('src/ui/contextualToolControls.ts').contextualToolControls,createDiv:()=>new Element(),createSpan:()=>new Element(),isTabletWebKitTouchDevice:()=>true,isShapeTool:t=>['line','rectangle','ellipse','triangle'].includes(t)};
const ctx={...globals};vm.runInNewContext(compiled,ctx);
const s=setup(ctx.Session,()=>new Element());
for(const tool of ['pen','eraser','text','select','highlighter','line','region']){
  s.currentTool=tool;s.refreshToolbar();
  const tools=s.toolbarEl.querySelector('.is-tools'),options=s.toolbarEl.querySelector('.is-tool-options');
  assert.equal(options,undefined,'Original toolbar keeps options with tools');
  for(const title of ['Select','Pen','Highlighter','Text','Shapes: Draw and hold'])assert.ok(tools.children.some(n=>n.title===title),title);
  assert.ok(!tools.children.some(n=>n.title?.includes('drawing options')),'No separate options gear');
}
s.currentTool='pen';s.opened=null;s.refreshToolbar();s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title==='Pen').activate();assert.equal(s.opened,null,'Text buttons must not expose a duplicate Pen menu');
s.opened=null;s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title==='Highlighter').activate();assert.equal(s.currentTool,'highlighter');assert.equal(s.opened,null);
s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title==='Highlighter').activate();assert.equal(s.opened,null,'Text buttons must not expose a duplicate Highlighter menu');
s.separate=false;s.currentTool='pen';s.refreshToolbar();assert.ok(s.toolbarEl.querySelector('.is-tools').children.some(n=>n.textContent==='Colour'));
// Text buttons own quick mode changes; the active icon must not open a duplicate.
s.currentTool='select';s.toolState.selectionMode='single';let selectionMenus=0;
s.openSelectionMenu=()=>selectionMenus++;
for(const [label,next]of [['Single','box'],['Box','lasso'],['Lasso','single']]){
 s.refreshToolbar();s.toolbarEl.querySelector('.is-tools').children.find(n=>n.textContent===label).activate();
 assert.equal(s.toolState.selectionMode,next,'Selection label must cycle to '+next);
}
assert.equal(selectionMenus,0,'Quick cycling must not open a menu');
s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title==='Select').activate();assert.equal(selectionMenus,0);assert.equal(s.toolState.selectionMode,'single');
// Menu presentation hides quick controls and routes each active icon to options.
s.plugin.getToolOptionsPresentation=()=> 'menus';
for(const tool of ['pen','highlighter','eraser','select','line','text']){
 s.currentTool=tool;s.refreshToolbar();const children=s.toolbarEl.querySelector('.is-tools').children;
 assert.ok(!children.some(n=>n.dataset?.toolOption),'Menu presentation must omit contextual quick controls');
 assert.ok(!children.some(n=>['Single','Box','Lasso','Touch erase','Object erase','Font'].includes(n.textContent)));
}
s.currentTool='eraser';let eraserMenus=0;s.openEraserModeMenu=()=>eraserMenus++;s.refreshToolbar();s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title.startsWith('Eraser (')).activate();assert.equal(eraserMenus,1);
for(const [tool,title]of [['pen','Pen'],['highlighter','Highlighter']]){s.currentTool=tool;s.opened=null;s.refreshToolbar();s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title===title).activate();assert.equal(s.opened,tool,'Menu mode must open the active tool options')}
s.currentTool='select';s.refreshToolbar();s.toolbarEl.querySelector('.is-tools').children.find(n=>n.title==='Select').activate();assert.equal(selectionMenus,1);
// Persisted preference defaults off and normalizes malformed saved values.
const controllerFile=path.join(root,'src/settings/settingsController.ts'),moduleShim={exports:{}};
const controllerContext={module:moduleShim,exports:moduleShim.exports,window:{setTimeout:()=>1,clearTimeout(){}},require:name=>loadSource(path.resolve(path.dirname(controllerFile),name+'.ts'))};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(controllerFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,controllerContext);
(async()=>{
  for(const [saved,expected] of [[undefined,true],[true,true],[false,false],['true',true]]){
    const c=new moduleShim.exports.PDFAnnotatorSettingsController(async()=>({separateToolOptions:saved}),async()=>{},()=>{});await c.load();assert.equal(c.shouldSeparateToolOptions(),expected);await c.updateBehaviorSettings({separateToolOptions:true});assert.equal(c.shouldSeparateToolOptions(),true);
  }
  for(const [saved,expected] of [[undefined,'buttons'],['buttons','buttons'],['menus','menus'],['invalid','buttons']]){
   const c=new moduleShim.exports.PDFAnnotatorSettingsController(async()=>({toolOptionsPresentation:saved}),async()=>{},()=>{});await c.load();assert.equal(c.getToolOptionsPresentation(),expected);
   await c.updateBehaviorSettings({toolOptionsPresentation:'menus'});assert.equal(c.getToolOptionsPresentation(),'menus');
   const reopened=new moduleShim.exports.PDFAnnotatorSettingsController(async()=>JSON.parse(JSON.stringify(c.settings)),async()=>{},()=>{});await reopened.load();assert.equal(reopened.getToolOptionsPresentation(),'menus');
  }
  console.log('Original toolbar passed: all tools, inline options, active-tool second click, no extra gear and legacy settings compatibility.');
})().catch(e=>{console.error(e);process.exitCode=1;});
