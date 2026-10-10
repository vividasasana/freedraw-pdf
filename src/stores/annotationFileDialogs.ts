import { AbstractInputSuggest, App, Modal, Setting, normalizePath, prepareFuzzySearch } from "obsidian";

export type AnnotationCleanupScope = { kind: "vault" | "folder" | "pdf"; path: string };
export type AnnotationFileResult = { path: string; reason: string };

export class AnnotationPathSuggest extends AbstractInputSuggest<string> {
	constructor(app:App, private readonly input:HTMLInputElement, private readonly paths:string[], private readonly picked:(path:string)=>void) {
		super(app,input);this.limit=50;
	}
	getSuggestions(query:string):string[] {
		const text=query.trim();if(!text || text==="/")return [];
		const search=prepareFuzzySearch(text);
		return this.paths.map(path=>({path,match:search(path)})).filter(entry=>entry.match!==null)
			.sort((a,b)=>b.match!.score-a.match!.score || a.path.localeCompare(b.path)).map(entry=>entry.path);
	}
	renderSuggestion(path:string,element:HTMLElement):void {element.setText(path || "Vault root (/)");}
	selectSuggestion(path:string):void {this.setValue(path || "/");this.picked(path);this.close();this.input.focus();}
}

class AnnotationScopeModal extends Modal {
	private cleanupScope:AnnotationCleanupScope;
	private accepted=false;
	private suggest:AnnotationPathSuggest|null=null;
	private pathInput:HTMLInputElement|null=null;
	constructor(app:App,private readonly pdfs:string[],private readonly folders:string[],activePdf:string|undefined,
		private readonly finish:(scope:AnnotationCleanupScope|null)=>void) {
		super(app);this.cleanupScope={kind:activePdf?"pdf":"vault",path:activePdf??""};
	}
	onOpen():void {
		this.setTitle("Choose annotation cleanup scope");
		let validate=()=>true;
		new Setting(this.contentEl).setName("Include").addDropdown(dropdown=>dropdown
			.addOption("pdf","One PDF").addOption("folder","A folder and its subfolders").addOption("vault","Whole vault")
			.setValue(this.cleanupScope.kind).onChange(value=>{this.cleanupScope={kind:value as AnnotationCleanupScope["kind"],path:""};renderTarget();}));
		const target=this.contentEl.createDiv();
		const renderTarget=()=>{
			this.suggest?.close();this.suggest=null;target.empty();
			if(this.cleanupScope.kind==="vault"){this.pathInput=null;validate=()=>true;target.createEl("p",{text:"All annotation JSON files in this vault are included."});return;}
			const paths=this.cleanupScope.kind==="pdf"?this.pdfs:this.folders;
			const error=target.createEl("p",{cls:"freedraw-pdf-path-error"});
			error.hidden=true;
			const update=(value:string)=>{
				const path=normalizePath(value.trim()).replace(/^\/+|\/+$/g,"");
				this.cleanupScope.path=path;error.hidden=true;
			};
			validate=()=>{
				const typed=this.cleanupScope.path.toLocaleLowerCase();
				const matches=paths.filter(path=>path.toLocaleLowerCase()===typed);
				if(matches.length===1){this.cleanupScope.path=matches[0];return true;}
				error.setText(`Enter a valid ${this.cleanupScope.kind==="pdf"?"PDF":"folder"} path. You can type it yourself or use a suggestion.`);error.hidden=false;this.pathInput?.focus();return false;
			};
			const row=new Setting(target).setName(this.cleanupScope.kind==="pdf"?"PDF":"Folder")
				.setDesc(this.cleanupScope.kind==="pdf"?"Type a PDF path or choose a suggestion.":"Type a folder path or choose a suggestion. Use / for the vault root.")
				.addText(text=>{
					this.pathInput=text.inputEl;
					text.inputEl.disabled=false;text.inputEl.readOnly=false;
					text.inputEl.setAttribute("autocomplete","off");
					text.inputEl.addClass("freedraw-pdf-path-input");
					text.inputEl.setAttribute("aria-label",this.cleanupScope.kind==="pdf"?"PDF path":"Folder path");
					text.setPlaceholder(this.cleanupScope.kind==="pdf"?"Folder/Question paper.pdf":"Folder/Subfolder")
						.setValue(this.cleanupScope.path || (this.cleanupScope.kind==="folder"?"/":"")).onChange(update);
					this.suggest=new AnnotationPathSuggest(this.app,text.inputEl,paths,path=>update(path));
					update(text.getValue());
				});
			row.settingEl.addClass("freedraw-pdf-path-setting");
		};
		renderTarget();
		new Setting(this.contentEl).addButton(button=>button.setButtonText("Cancel").onClick(()=>this.close()))
			.addButton(button=>{button.setButtonText("Continue").setCta().onClick(()=>{if(!validate())return;this.accepted=true;this.close();});});
	}
	onClose():void {this.suggest?.close();this.suggest=null;this.contentEl.empty();this.finish(this.accepted?this.cleanupScope:null);}
}

export function chooseAnnotationScope(app: App, activePdf?: string): Promise<AnnotationCleanupScope | null> {
	const pdfs = new Set<string>();
	const folders = new Set<string>([""]);
	for (const file of app.vault.getFiles()) {
		if (file.extension.toLowerCase() === "pdf") pdfs.add(file.path);
		if (file.path.endsWith(".annot.json")) pdfs.add(file.path.slice(0, -".annot.json".length).replace(/\.recovery-[^/]+$/, ""));
		let folder = file.parent?.path ?? "";
		while (folder) { folders.add(folder); folder = folder.slice(0, Math.max(0, folder.lastIndexOf("/"))); }
	}
	return new Promise(resolve => new AnnotationScopeModal(app, [...pdfs].sort(), [...folders].sort(), activePdf, resolve).open());
}

class AnnotationReportModal extends Modal {
	constructor(app: App, private readonly summary: string, private readonly rows: AnnotationFileResult[]) { super(app); }
	onOpen(): void {
		this.setTitle("Cleanup complete");
		this.contentEl.createEl("p", {text: this.summary});
		const list = this.contentEl.createDiv({cls:"freedraw-pdf-file-report"});
		for (const row of this.rows) new Setting(list).setName(row.path.slice(row.path.lastIndexOf("/") + 1)).setDesc(row.reason);
		if (!this.rows.length) list.createEl("p", {text:"No matching annotation files needed changes."});
		new Setting(this.contentEl).addButton(button => button.setButtonText("Close").onClick(() => this.close()));
	}
	onClose(): void { this.contentEl.empty(); }
}

export function showAnnotationReport(app: App, summary: string, rows: AnnotationFileResult[]): void {
	new AnnotationReportModal(app, summary, rows).open();
}

class AnnotationConfirmationModal extends Modal {
	private accepted = false;
	constructor(app: App, private readonly title: string, private readonly message: string,
		private readonly action: string, private readonly finish: (value: boolean) => void,
		private readonly details: { label: string; value: string }[] = []) { super(app); }
	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.createEl("p", { text: this.message });
		if (this.details.length) {
			const list = this.contentEl.createEl("dl", { cls: "freedraw-pdf-file-details" });
			for (const detail of this.details) {
				list.createEl("dt", { text: detail.label });
				list.createEl("dd", { text: detail.value });
			}
		}
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText("Keep data").onClick(() => this.close()))
			.addButton(button => button.setButtonText(this.action).setWarning().onClick(() => {
				this.accepted = true;
				this.close();
			}));
	}
	onClose(): void { this.contentEl.empty(); this.finish(this.accepted); }
}

export function confirmAnnotationAction(app: App, title: string, message: string, action: string,
	details: { label: string; value: string }[] = []): Promise<boolean> {
	return new Promise(resolve => new AnnotationConfirmationModal(app, title, message, action, resolve, details).open());
}

class AnnotationFileChoiceModal extends Modal {
	private selected: string;
	private accepted = false;
	constructor(app: App, private readonly title: string, private readonly message: string,
		private readonly paths: string[], private readonly finish: (value: string | null) => void) {
		super(app); this.selected = paths[0];
	}
	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl).setName("Annotation data JSON").addDropdown(dropdown => {
			for (const path of this.paths) dropdown.addOption(path, path.slice(path.lastIndexOf("/") + 1));
			dropdown.setValue(this.selected).onChange(value => this.selected = value);
		});
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton(button => button.setButtonText("Use selected data").setCta().onClick(() => {
				this.accepted = true; this.close();
			}));
	}
	onClose(): void { this.contentEl.empty(); this.finish(this.accepted ? this.selected : null); }
}

export function chooseAnnotationFile(app: App, title: string, message: string, paths: string[]): Promise<string | null> {
	if (!paths.length) return Promise.resolve(null);
	return new Promise(resolve => new AnnotationFileChoiceModal(app, title, message, paths, resolve).open());
}
