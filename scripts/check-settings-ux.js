const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {loadSource}=require('./load-source');
class Element {
 constructor(tag='div',options={}){this.tag=tag;this.text=options.text;this.cls=options.cls;this.children=[];}
 createEl(tag,options={}){const node=new Element(tag,options);this.children.push(node);return node;}
 createDiv(options={}){return this.createEl('div',options);}
 addClass(){} empty(){this.children=[];this.scrollTop=0;this.emptyCalls=(this.emptyCalls||0)+1;}
}
class Component {
 addOption(){return this;} setValue(v){this.value=v;return this;} onChange(fn){this.change=fn;return this;}
 setLimits(){return this;} setDynamicTooltip(){return this;}
	setButtonText(){return this;} setDisabled(){return this;} onClick(fn){this.click=fn;return this;}
}
class Setting {
 constructor(parent){this.node=parent.createDiv({cls:'setting-item'});}
 setName(v){this.node.name=v;return this;} setDesc(v){this.node.desc=v;return this;}
 addDropdown(fn){this.node.component=new Component();fn(this.node.component);return this;}
 addToggle(fn){return this.addDropdown(fn);} addSlider(fn){return this.addDropdown(fn);} addColorPicker(fn){return this.addDropdown(fn);}
	addButton(fn){return this.addDropdown(fn);}
}
class PluginSettingTab {constructor(){this.containerEl=new Element();}}
const file=path.resolve(__dirname,'../src/settings/settingTab.ts');
const moduleShim={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
 {module:moduleShim,exports:moduleShim.exports,require:name=>name==='obsidian'?{PluginSettingTab,Setting,Plugin:class{}}:loadSource(path.resolve(path.dirname(file),name+'.ts'))});
const {DEFAULT_SETTINGS}=loadSource('src/config.ts');
let quick={source:'previous',template:'grid',paperColor:'#ffffff'};
const plugin={getQuickAddPageSettings:()=>({...quick}),getInkRenderSettings:()=>DEFAULT_SETTINGS.inkRenderSettings,getToolDefaults:()=>DEFAULT_SETTINGS.toolDefaults,
 getStoredPresets:()=>[],getInkInputPolicy:()=> 'pen-mouse-only',getLivePreviewMode:()=> 'auto-smooth',getAutosaveDelayMs:()=>600,
 getInlineToolbarPreference:()=>true,shouldShowRegionToolbarButton:()=>false,shouldShowCopyEmbedToolbarButton:()=>false,
 shouldAutoCopyRegionEmbed:()=>true,shouldShowAnnotatedEmbedHeader:()=>false,shouldShowDrawingNotices:()=>false,shouldShowRenderTelemetry:()=>false,
 updateBehaviorSettings:async patch=>{if(patch.quickAddPageSettings)quick=patch.quickAddPageSettings;},updateToolPreferences(){}};
function flatten(node){return node.hidden?[]:[node,...node.children.flatMap(flatten)];}
async function main(){
 const tab=new moduleShim.exports.PDFAnnotatorSettingTab({},plugin);tab.display();
 let nodes=flatten(tab.containerEl);
 assert.ok(!nodes.some(n=>n.name==='Default template'||n.name==='Default paper colour'),'Inherited styling must hide configured-default controls');
 const headings=nodes.filter(n=>n.tag==='h3').map(n=>n.text);
 for(const heading of ['Drawing input','Pen pressure','Stroke smoothing','Tool sizes','Stroke ends','Pages / Quick add','Toolbar','Markdown embeds','Saving','File management','Debug'])assert.ok(headings.includes(heading),heading);
 assert.equal(nodes.filter(n=>n.cls==='freedraw-pdf-settings-group').length,11,'Sections need separate settings cards');
 assert.ok(!nodes.some(n=>n.cls==='freedraw-pdf-settings-section-description'),'Section headings must not add subtitle rows outside the cards');
 for(const section of nodes.filter(n=>n.cls==='freedraw-pdf-settings-section')){
  assert.equal(section.children[0].tag,'h3');
  assert.equal(section.children[1].cls,'freedraw-pdf-settings-group','Each heading must sit directly above its own card');
 }
 const selector=nodes.find(n=>n.name==='Quick-add style source');
 const emptyCalls=tab.containerEl.emptyCalls;tab.containerEl.scrollTop=650;
 await selector.component.change('defaults');
 assert.equal(tab.containerEl.emptyCalls,emptyCalls,'Changing style must not rebuild the settings page');
 assert.equal(tab.containerEl.scrollTop,650,'Changing style must not reset the scroll position');
 nodes=flatten(tab.containerEl);
 assert.equal(nodes.filter(n=>n.name==='Default template').length,1);
 assert.equal(nodes.filter(n=>n.name==='Default paper colour').length,1);
 assert.equal(nodes.find(n=>n.name==='Quick-add style source'),selector,'The focused dropdown must remain the same DOM element');
 await nodes.find(n=>n.name==='Quick-add style source').component.change('previous');
 assert.ok(!flatten(tab.containerEl).some(n=>n.name==='Default template'));
 assert.equal(tab.containerEl.scrollTop,650);
 const source=fs.readFileSync(path.resolve(__dirname,'../main.ts'),'utf8');
 assert.ok(!source.includes('.setTitle("Create native mixed working PDF")'),'Remove working-PDF conversion from the regular menu');
 const start=source.indexOf('private openAddPageMenu('),end=source.indexOf('private requestDangerConfirmation(',start);
 assert.ok(!source.slice(start,end).includes('Go to page...'),'Page menu must not duplicate the native page navigator');
 assert.equal((source.match(/let syncPaperDropdown:/g)||[]).length,2,'Both page-creation dialogs must support custom colours');
 for(const name of ['openAddedPagePaperColorMenu','openPdfPagePaperColorMenu']){
  const i=source.indexOf('private '+name+'('),j=source.indexOf('\n\tprivate ',i+8);
  assert.ok(source.slice(i,j).includes('Custom colour...'),name+' must expose custom colours');
 }
 console.log('Settings UX passed: clear section cards, conditional defaults, source-switch refresh, simpler menus and consistent custom colours.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
