import { requestUrl, type ButtonComponent, type Setting, type TextComponent } from "obsidian";
import type { OcrSettings } from "./model";
import { listGeminiModels, type OcrModelChoice, type OcrTransport } from "./providers";

export interface OcrSettingsHost {
	getOcrSettings(): OcrSettings;
	updateOcrSettings(settings: OcrSettings): void;
	getOcrCredential(): string;
	hasOcrCredential(): boolean;
	setOcrCredential(value: string): void;
}
type SettingRow = {name:string;desc:string;render:(setting:Setting)=>void;visible?:()=>boolean};
const modelLists = new WeakMap<OcrSettingsHost,OcrModelChoice[]>();
const modelHelp = "Load the current models available to your Gemini API project, then choose one. This request sends your API key to Google, without handwriting.";

/** The same controls are used in plugin settings and the OCR service dialog. */
export function ocrSettingRows(host: OcrSettingsHost, transport:OcrTransport=requestUrl): SettingRow[] {
	let modelRow:Setting|undefined, endpoint:TextComponent|undefined, credential:TextComponent|undefined;
	let loadButton:ButtonComponent|undefined, requestGeneration=0;
	const patch = (next:Partial<OcrSettings>):void => host.updateOcrSettings({...host.getOcrSettings(),...next});
	const renderModel=(setting:Setting):void=>{
		modelRow=setting;setting.clear().setName("Recognition model");loadButton=undefined;
		const settings=host.getOcrSettings();
		if(settings.provider!=="gemini") {
			setting.setDesc("Enter an image-capable model name for your service. A local server may leave this blank to use its default.")
				.addText(t=>t.setValue(settings.model).onChange(value=>patch({model:value})));
			return;
		}
		const models=modelLists.get(host)??[],saved=settings.model.replace(/^models\//,"");
		setting.setDesc(modelHelp).addDropdown(d=>{
			d.addOption("",models.length?"Choose a model":"Load models first");
			for(const model of models)d.addOption(model.id,`${model.label} (${model.id})`);
			if(saved&&!models.some(m=>m.id===saved))d.addOption(saved,`${saved} — ${models.length?"unavailable; choose another":"saved, not checked"}`);
			d.setValue(saved).onChange(value=>{
				patch({model:value});
				setting.setDesc(value && models.some(model=>model.id===value) ? "Model selected. Handwriting is sent only when you choose Recognise." : modelHelp);
			});d.selectEl.setAttribute("aria-label","Gemini recognition model");
		}).addButton(b=>{loadButton=b;b.setButtonText(models.length?"Refresh models":"Load models").onClick(()=>{void loadModels();});});
	};
	const loadModels=async():Promise<void>=>{
		const generation=++requestGeneration,button=loadButton,row=modelRow;
		button?.setDisabled(true).setButtonText("Loading…");
		try {
			const models=await listGeminiModels(host.getOcrCredential(),transport);
			if(generation!==requestGeneration||host.getOcrSettings().provider!=="gemini")return;
			modelLists.set(host,models);if(row)renderModel(row);
			const selected=host.getOcrSettings().model.replace(/^models\//,"");
			row?.setDesc(selected&&!models.some(m=>m.id===selected)?"Your saved model is unavailable to this API project. Choose an available model from the refreshed list.":`${models.length} models loaded from your Gemini project. Choose a model; handwriting is sent only when you recognise it.`);
		} catch(error) {
			if(generation===requestGeneration)row?.setDesc(error instanceof Error?error.message:"Could not load Gemini models. Try again.");
		} finally {
			if(generation===requestGeneration&&button===loadButton)button?.setDisabled(false).setButtonText(modelLists.has(host)?"Refresh models":"Load models");
		}
	};
	return [
		{name:"OCR toolbar button",desc:"Show a separate OCR options button. OCR also remains available from More annotation actions.",render:s=>{
			s.setName("OCR toolbar button").setDesc("Show a separate OCR options button. OCR also remains available from More annotation actions.")
				.addToggle(t=>t.setValue(host.getOcrSettings().showToolbarButton).onChange(value=>patch({showToolbarButton:value})));
		}},
		{name:"Recognition service",desc:"Choose an online API account or your own OCR program/server.",render:setting=>{
			setting.setName("Recognition service").setDesc("Gemini and OpenAI-compatible services use your API account. Local server connects to an OCR program on this computer or another device.")
				.addDropdown(d=>d.addOption("gemini","Gemini").addOption("openai","OpenAI-compatible vision").addOption("local","Local OCR server").setValue(host.getOcrSettings().provider).onChange(value=>{
					const provider=value==="openai"||value==="local"?value:"gemini";requestGeneration++;
					const next:Partial<OcrSettings>={provider,model:"",endpoint:provider==="openai"?"https://api.openai.com/v1/chat/completions":provider==="local"?"http://127.0.0.1:8767/ocr":""};
					patch(next);if(modelRow)renderModel(modelRow);endpoint?.setValue(next.endpoint??"").setDisabled(provider==="gemini");
					credential?.setValue("").setPlaceholder(host.hasOcrCredential()?"Key already saved":"API key or local server token");
				}));
		}},
		{name:"Recognition model",desc:modelHelp,render:renderModel},
		{name:"Recognition endpoint",desc:"Full OCR server or OpenAI-compatible chat/completions URL. Gemini uses its official endpoint. On iPad, localhost refers to the iPad itself.",render:s=>{
			s.setName("Recognition endpoint").setDesc("Full OCR server or OpenAI-compatible chat/completions URL. Gemini uses its official endpoint. On iPad, localhost refers to the iPad itself.")
				.addText(t=>{endpoint=t;t.setValue(host.getOcrSettings().endpoint).setPlaceholder("Official Gemini endpoint").setDisabled(host.getOcrSettings().provider==="gemini").onChange(value=>{
					patch({endpoint:value});credential?.setValue("").setPlaceholder(host.hasOcrCredential()?"Key already saved for this endpoint":"API key or local server token");
				});});
		}},
		{name:"Recognition API key",desc:"Stored in Obsidian secret storage, separate from annotation JSON. Leave blank for an unauthenticated local server.",render:s=>{
			s.setName("Recognition API key").setDesc("Stored in Obsidian secret storage for this endpoint. Changing servers requires that server's key. Leave blank to keep the saved key; use Clear key to remove it.")
				.addText(t=>{credential=t;t.inputEl.type="password";t.setPlaceholder(host.hasOcrCredential()?"Key already saved":"API key or local server token").onChange(value=>{if(value.trim()){host.setOcrCredential(value.trim());modelLists.delete(host);requestGeneration++;if(modelRow)renderModel(modelRow);}});})
				.addButton(b=>b.setButtonText("Clear key").onClick(()=>{host.setOcrCredential("");modelLists.delete(host);requestGeneration++;credential?.setValue("").setPlaceholder("API key or local server token");if(modelRow)renderModel(modelRow);}));
		}},
		{name:"Recognition language",desc:"Language hint. Review scientific notation and formulae before accepting the result.",render:s=>{
			s.setName("Recognition language").setDesc("Language hint. Review scientific notation and formulae before accepting the result.")
				.addText(t=>t.setValue(host.getOcrSettings().language).onChange(value=>patch({language:value})));
		}},
		{name:"Keep handwriting, copy text",desc:"Keep handwriting visible after recognition. Copy uses its accepted text.",render:s=>{
			s.setName("Keep handwriting, copy text").setDesc("Keep handwriting visible after recognition. Copy uses its accepted text.")
				.addToggle(toggle=>toggle.setValue(host.getOcrSettings().copyHandwritingAsText === true).onChange(value=>patch({copyHandwritingAsText:value})));
		}},
		{name:"Device recognition",desc:"Apple Vision, Android ML Kit and Windows OCR need a native helper. Use its local server or paste a transcript; no helper or local model is installed automatically.",render:s=>{
			s.setName("Device recognition").setDesc("Apple Vision, Android ML Kit and Windows OCR need a native helper. Connect it through Local OCR server, or choose Paste transcript to use text from another app. No helper or local model is installed automatically.");
		}}
	];
}
