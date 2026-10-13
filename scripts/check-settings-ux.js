const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {loadSource}=require('./load-source');
class Element {
 constructor(tag='div',options={}){this.tag=tag;this.text=options.text;this.cls=options.cls;this.children=[];}
 createEl(tag,options={}){const node=new Element(tag,options);this.children.push(node);return node;}
 createDiv(options={}){return this.createEl('div',options);}
 addClass(cls){this.cls=cls;} empty(){this.children=[];this.scrollTop=0;this.emptyCalls=(this.emptyCalls||0)+1;}
}
class Component {
 constructor(){this.selectEl={options:[]};}
 addOption(value,label){this.selectEl.options.push({value,label});return this;} setValue(v){this.value=v;return this;} onChange(fn){this.change=fn;return this;}
 setLimits(){return this;} setDynamicTooltip(){return this;}
	setButtonText(){return this;} setDisabled(){return this;} onClick(fn){this.click=fn;return this;}
}
class Setting {
 constructor(parent){this.node=parent.createDiv({cls:'setting-item'});this.settingEl=this.node;}
 setHeading(){this.node.heading=true;return this;} setName(v){this.node.name=v;return this;} setDesc(v){this.node.desc=v;return this;}
 addDropdown(fn){this.node.component=new Component();(this.node.components??=[]).push(this.node.component);fn(this.node.component);return this;}
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
 const tab=new moduleShim.exports.PDFAnnotatorSettingTab({},plugin);
 const groups=tab.getSettingDefinitions();
 assert.equal(groups.length,11,'Searchable definitions preserve all section groups');
 assert.equal(groups.flatMap(g=>g.items).find(r=>r.name==='Quick-add template').visible(),true);
 for(const group of groups)for(const row of group.items){assert.equal(row.render(new Setting(new Element())),undefined,'Render callbacks must return void');}
 tab.display();
 let nodes=flatten(tab.containerEl);
 assert.ok(nodes.some(n=>n.name==='Default template')&&nodes.some(n=>n.name==='Default paper colour'),'Automatic inheritance must expose the first-page defaults');
 const headings=nodes.filter(n=>n.heading).map(n=>n.name);
 for(const heading of ['Drawing input','Pen pressure','Stroke smoothing','Tool sizes','Stroke ends','Pages / Quick add','Toolbar','Markdown embeds','Saving','File management','Debug'])assert.ok(headings.includes(heading),heading);
 assert.equal(nodes.filter(n=>n.cls==='freedraw-pdf-settings-group').length,11,'Sections need separate settings cards');
 assert.ok(!nodes.some(n=>n.cls==='freedraw-pdf-settings-section-description'),'Section headings must not add subtitle rows outside the cards');
 for(const section of nodes.filter(n=>n.cls==='freedraw-pdf-settings-section')){
  assert.equal(section.children[0].heading,true);
  assert.equal(section.children[1].cls,'freedraw-pdf-settings-group','Each heading must sit directly above its own card');
 }

 assert.ok(!nodes.some(n=>n.name==='Quick-add style source'),'Remove the inheritance selector');
 const template=nodes.find(n=>n.name==='Default template');
 const emptyCalls=tab.containerEl.emptyCalls;tab.containerEl.scrollTop=650;
 await template.component.change('dot');
 assert.equal(quick.template,'dot');
 assert.equal(tab.containerEl.emptyCalls,emptyCalls,'Editing defaults must not rebuild settings');
 assert.equal(tab.containerEl.scrollTop,650);
 const paper=nodes.find(n=>n.name==='Default paper colour');
 const [paperDropdown,paperPicker]=paper.components;
 assert.deepEqual(paperDropdown.selectEl.options.map(o=>o.label),['Cream','White','Soft yellow','Blue tint','Green tint','Gray']);
 await paperDropdown.change('#fff7cc');
 assert.equal(paperPicker.value,'#fff7cc');assert.equal(quick.paperColor,'#fff7cc');
 for(const color of ['#123456','#654321','#AA00AA']){
  await paperPicker.change(color);assert.equal(paperDropdown.value,color);assert.equal(quick.paperColor,color);
  assert.equal(paperDropdown.selectEl.options.length,7,'Keep one custom entry while changing the picker');
 }
 await paperPicker.change('#FFFFFF');assert.equal(paperDropdown.value,'#ffffff','Preset matching must ignore hex case');
 assert.equal(tab.containerEl.emptyCalls,emptyCalls,'Paper controls must not rebuild settings');assert.equal(tab.containerEl.scrollTop,650);
 const reopened=new Setting(new Element());groups.flatMap(g=>g.items).find(r=>r.name==='Quick-add paper colour').render(reopened);
 assert.equal(reopened.node.components[0].value,'#ffffff');assert.equal(reopened.node.components[1].value,'#FFFFFF');
 assert.ok(nodes.some(n=>n.desc?.includes('latest template')),'Explain automatic inheritance in a short note below the defaults');
 const source=fs.readFileSync(path.resolve(__dirname,'../main.ts'),'utf8');
 assert.ok(!source.includes('.setTitle("Create native mixed working PDF")'),'Remove working-PDF conversion from the regular menu');
 const start=source.indexOf('private openAddPageMenu('),end=source.indexOf('private requestDangerConfirmation(',start);
 assert.ok(!source.slice(start,end).includes('Go to page...'),'Page menu must not duplicate the native page navigator');
 assert.equal((source.match(/let syncPaperDropdown:/g)||[]).length,2,'Both page-creation dialogs must support custom colours');
 for(const name of ['openAddedPagePaperColorMenu','openPdfPagePaperColorMenu']){
  const i=source.indexOf('private '+name+'('),j=source.indexOf('\n\tprivate ',i+8);
  assert.ok(source.slice(i,j).includes('Custom colour...'),name+' must expose custom colours');
 }
 console.log('Settings UX passed: aligned cards, preset/picker sync, one custom entry, persisted defaults and unchanged scroll position.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
