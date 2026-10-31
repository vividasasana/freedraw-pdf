const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const previous = require.extensions['.ts'],previousLoad=Module._load,modals=[];
class Element {
 constructor(){this.settings=[];this.ownerDocument={defaultView:{setInterval,clearInterval}};this.classList={add(){}};}
 addClass(){} setAttribute(){} empty(){} querySelectorAll(){return [];} createEl(){return new Element();} toggleClass(){}
}
class Component {
 constructor(){this.options=new Map();this.inputEl={setAttribute(){}};this.buttonEl={toggleClass(){},classList:{add(){}}};this.selectEl={setAttribute(){},querySelector:value=>this.options.get(value.match(/value="([^"]+)"/)[1])};}
 addOption(id,label){this.options.set(id,{id,label,disabled:false});return this;}setValue(value){this.value=value;return this;}onChange(handler){this.change=handler;return this;}
 setButtonText(value){this.label=value;return this;}setDisabled(value){this.disabled=value;return this;}onClick(handler){this.click=handler;return this;}setPlaceholder(value){this.placeholder=value;return this;}setCta(){return this;}
}
class Setting {
 constructor(el){this.controls=[];this.settingEl=new Element();el.settings.push(this);}setName(v){this.name=v;return this;}setDesc(v){this.desc=v;return this;}clear(){this.controls=[];return this;}
 add(kind,handler){const control=new Component();control.kind=kind;this.controls.push(control);handler(control);return this;}
 addDropdown(fn){return this.add('dropdown',fn);}addText(fn){return this.add('text',fn);}addTextArea(fn){return this.add('textarea',fn);}addButton(fn){return this.add('button',fn);}addToggle(fn){return this.add('toggle',fn);}
}
class Modal {
 constructor(){this.contentEl=new Element();}setTitle(title){this.title=title;}open(){modals.push(this);this.onOpen();}close(){this.onClose?.();}
}
Module._load=function(id,parent,main){if(id==='obsidian')return {Setting,Modal,requestUrl:async()=>{throw Error('Unexpected network call');}};if(parent?.filename.endsWith('sessionController.ts')&&id==='./input')return {createOcrInput:async()=>({image:'data:image/png;base64,AAAA',box:{left:0,top:0,right:1,bottom:1}})};return previousLoad.call(this,id,parent,main);};
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
async function run(){
 const {listGeminiModels,recogniseInk,OcrServiceError} = require('../src/ocr/providers.ts');
 assert.equal(typeof listGeminiModels,'function','Gemini model choices must come from the account ListModels endpoint');
 const requests=[];
 const models=await listGeminiModels('fixture-secret',async request=>{
  requests.push(request);
  return {status:200,json:requests.length===1?{models:[{name:'models/gemini-current-flash',displayName:'Current Flash',supportedGenerationMethods:['generateContent']},{name:'models/text-embedding',supportedGenerationMethods:['embedContent']},{name:'models/gemini-audio-tts',supportedGenerationMethods:['generateContent']}],nextPageToken:'page two'}:{models:[{name:'models/gemini-current-pro',supportedGenerationMethods:['generateContent']},{name:'models/gemini-current-flash',supportedGenerationMethods:['generateContent']}]}};
 });
 assert.deepEqual(models.map(m=>m.id),['gemini-current-flash','gemini-current-pro']);
 assert.equal(models[0].label,'Current Flash');assert.equal(requests.length,2);
 for(const request of requests){assert.equal(request.method,'GET');assert.equal(request.headers['x-goog-api-key'],'fixture-secret');assert.ok(!request.url.includes('fixture-secret'));assert.ok(!request.body,'model discovery must not send a handwriting image');}
 assert.ok(requests[1].url.includes('pageToken=page+two'));
 await assert.rejects(listGeminiModels('',()=>{throw Error('must not request')}),/API key/);
 await assert.rejects(listGeminiModels('fixture-secret',async()=>({status:403,json:{error:{message:'fixture-secret'}}})),error=>error.message.includes('403')&&!error.message.includes('fixture-secret'));
 await assert.rejects(listGeminiModels('fixture-secret',async()=>({status:200,json:{models:[],nextPageToken:'repeat'}})),/repeated|too many/i);
 const settings={provider:'gemini',model:'models/gemini-retired',endpoint:'',language:'English',showToolbarButton:true};
 await assert.rejects(recogniseInk(settings,'fixture-secret','data:image/png;base64,AAAA',{left:0,top:0,right:1,bottom:1},async request=>{
  assert.ok(request.url.endsWith('/models/gemini-retired:generateContent'),'models/ resource names are normalized once');
  return {status:404,json:{error:{message:'fixture-secret and private service response'}}};
 }),error=>error instanceof OcrServiceError&&error.status===404&&error.modelUnavailable&&/Refresh models/.test(error.message)&&!error.message.includes('fixture-secret'));
 // Exercise the actual shared native Setting row renderers: a dropdown, not a model textbox.
 const {ocrSettingRows}=require('../src/ocr/settingsRows.ts'),{openOcrOptions}=require('../src/ocr/dialogs.ts');
 let current={...settings,model:'gemini-retired'},key='fixture-secret',modelCalls=0;
 const host={getOcrSettings:()=>({...current}),updateOcrSettings:value=>{current=value;},getOcrCredential:()=>key,hasOcrCredential:()=>!!key,setOcrCredential:value=>{key=value;}};
 const rows=ocrSettingRows(host,async()=>{modelCalls++;return {status:200,json:{models:[{name:'models/gemini-current-flash',displayName:'Current Flash',supportedGenerationMethods:['generateContent']}]}};});
 const el={settings:[]};for(const row of rows)row.render(new Setting(el));
 const modelRow=el.settings.find(s=>s.name==='Recognition model');assert.equal(modelRow.controls[0].kind,'dropdown');assert.equal(modelCalls,0,'opening settings must not send a model-list request');
 modelRow.controls.find(c=>c.kind==='button').click();await new Promise(setImmediate);
 assert.equal(modelCalls,1);assert.ok(modelRow.controls[0].options.has('gemini-current-flash'));assert.match(modelRow.desc,/saved model is unavailable/);
 modelRow.controls[0].change('gemini-current-flash');assert.equal(current.model,'gemini-current-flash');assert.ok(!/saved model is unavailable/.test(modelRow.desc),'Choosing an available model must clear the old warning');
 el.settings.find(s=>s.name==='Recognition service').controls[0].change('local');assert.equal(modelRow.controls[0].kind,'text');assert.equal(current.endpoint,'http://127.0.0.1:8767/ocr');
 let scopeAction;openOcrOptions({}, {selectedCount:0,provider:'fixture',busy:false,settingsHost:host,run:(...value)=>scopeAction=value});
 const options=modals.at(-1),scope=options.contentEl.settings.find(s=>s.name==='Apply to');assert.ok(scope.controls[0].options.get('selection').disabled);assert.match(scope.desc,/Select strokes first/);
 options.contentEl.settings.find(s=>s.name==='Recognition service').controls[0].click();assert.equal(modals.at(-1).title,'OCR service options');
 assert.ok(modals.at(-1).contentEl.settings.some(s=>s.name==='Recognition API key'));
 options.contentEl.settings.find(s=>s.name==='Display').controls[0].click();assert.deepEqual(scopeAction,['page','ink']);
 // A real controller error reopens configuration without applying or retrying ink.
 const {OcrSessionController}=require('../src/ocr/sessionController.ts');
 current={...settings,model:'models/gemini-retired'};
 const document={strokes:[{id:'one',page:1,tool:'pen',color:'#ff0000',width:3,points:[{x:.2,y:.2,pressure:.5},{x:.4,y:.3,pressure:.5}]}]},source=JSON.stringify(document),notices=[];
 let apiCalls=0,changes=0;
 const controller=new OcrSessionController({app:{},owner:{setTimeout,clearTimeout},capture:()=>({document,filePath:'sample.pdf',page:1,strokes:document.strokes,aspect:1.414}),isCurrent:()=>true,settings:()=>current,settingsHost:host,credential:()=>key,transport:async()=>{apiCalls++;return {status:404,json:{error:{message:'private provider details'}}};},notice:message=>notices.push(message),beforeChange:()=>changes++,changed:()=>changes++});
 await controller.run('page','recognise');assert.equal(apiCalls,1);assert.equal(changes,0);assert.equal(JSON.stringify(document),source);
 assert.equal(modals.at(-1).title,'Handwriting recognition');assert.ok(modals.at(-1).contentEl.settings.some(s=>/Refresh models/.test(s.desc)));
 assert.ok(modals.at(-1).contentEl.settings.some(s=>/HTTP 404/.test(s.desc)));assert.ok(notices.every(message=>!message.includes('private provider details')));
 console.log('OCR model discovery passed: account endpoint, pagination, filters, no image/key URL leakage, actionable 404, shared settings dropdown and service options, scope explanation and reversible display.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{require.extensions['.ts']=previous;Module._load=previousLoad;});
