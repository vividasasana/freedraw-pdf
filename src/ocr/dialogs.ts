import { App, Modal, Setting, type ButtonComponent, type DropdownComponent, type ToggleComponent } from "obsidian";
import type { OcrLine } from "./model";
import type { NormalizedRect } from "../types";
import { ocrSettingRows, type OcrSettingsHost } from "./settingsRows";

export type OcrScope = "selection" | "page" | "document";
export type OcrAction = "recognise" | "paste" | "text" | "ink" | "cancel" | "retry";
export interface OcrProgressState {
 stage: "idle" | "preparing" | "recognising" | "review" | "completed" | "failed" | "cancelled";
 running: boolean; scope: OcrScope; total: number; index: number; page?: number; completed: number; failed: number; skipped: number;
 startedAt: number; message: string; errors: string[];
}
function styleButtons(container: HTMLElement): void {
 for (const button of Array.from(container.querySelectorAll<HTMLButtonElement>("button:not(.clickable-icon)")))
  button.classList.add("pdf-native-annotator-button", "pdf-native-annotator-text-button");
}
export function openOcrServiceSettings(app: App, host: OcrSettingsHost, onClose?: () => void): void {
 class ServiceOptions extends Modal {
  onOpen(): void {
   this.setTitle("OCR service options"); this.modalEl?.addClass("pdf-native-annotator-dialog"); this.contentEl.addClass("freedraw-pdf-ocr-service-options");
   for (const row of ocrSettingRows(host).filter(row => row.name !== "OCR toolbar button" && row.name !== "Keep handwriting, copy text")) row.render(new Setting(this.contentEl));
   new Setting(this.contentEl).addButton(button => button.setButtonText("Done").onClick(() => this.close()));
   styleButtons(this.contentEl);
  }
  onClose(): void { this.contentEl.empty(); onClose?.(); }
 }
 new ServiceOptions(app).open();
}
interface OptionsConfig {
 selectedCount: number; pageStrokeCount?: number; pageCount?: number; provider: string; busy: boolean; settingsHost?: OcrSettingsHost; error?: string;
 state?: OcrProgressState; initialScope?: OcrScope;
 subscribe?: (listener: (state: OcrProgressState) => void) => () => void;
 canDisplay?: (scope: OcrScope, mode: "text" | "ink") => boolean;
 run: (scope: OcrScope, action: OcrAction) => void;
}
export function openOcrOptions(app: App, options: OptionsConfig): () => void {
 let closed = false;
 class Options extends Modal {
  private unsubscribe: (() => void) | undefined;
  private timer: number | undefined;
  onOpen(): void {
   this.setTitle("Handwriting recognition"); this.modalEl?.addClass("pdf-native-annotator-dialog"); this.contentEl.addClass("freedraw-pdf-ocr-options");
   const owner = this.contentEl.ownerDocument.defaultView;
   let scope: OcrScope = options.state?.stage && options.state.stage !== "idle" ? options.initialScope ?? "page" : options.selectedCount ? "selection" : "page";
   if (scope === "selection" && !options.selectedCount || scope === "document" && !options.pageCount) scope = "page";
   let state = options.state;
   let scopeControl: DropdownComponent | undefined, recognise: ButtonComponent | undefined, cancel: ButtonComponent | undefined;
   let retry: ButtonComponent | undefined, paste: ButtonComponent | undefined, text: ButtonComponent | undefined, ink: ButtonComponent | undefined, configure: ButtonComponent | undefined;
   let keepHandwriting: ToggleComponent | undefined;
   const scopeRow = new Setting(this.contentEl).setName("Apply to");
   let refresh = (): void => undefined;
   scopeRow.addDropdown(dropdown => {
    scopeControl = dropdown;
    dropdown.addOption("page", "Current page").addOption("selection", options.selectedCount ? "Selected handwriting (" + options.selectedCount + " strokes)" : "Selected handwriting — select ink first")
     .addOption("document", "Whole PDF (" + (options.pageCount ?? 0) + " handwriting pages)").setValue(scope);
    const selection = dropdown.selectEl.querySelector<HTMLOptionElement>('option[value="selection"]');
    if (selection) selection.disabled = !options.selectedCount;
    const documentOption = dropdown.selectEl.querySelector<HTMLOptionElement>('option[value="document"]');
    if (documentOption) documentOption.disabled = !options.pageCount;
    dropdown.onChange(value => { scope = value === "document" ? "document" : value === "selection" ? "selection" : "page"; refresh(); });
   });
   const status = new Setting(this.contentEl).setName("Status");
   status.settingEl.classList.add("freedraw-pdf-ocr-progress");
   status.settingEl.setAttribute("role", "status"); status.settingEl.setAttribute("aria-live", "polite");
   const progress = status.settingEl.createEl("progress", { cls: "freedraw-pdf-ocr-progress-bar", attr: { "aria-label": "Pages processed" } });
   const details = this.contentEl.createEl("details", { cls: "freedraw-pdf-ocr-job-details" });
   details.createEl("summary", { text: "Page details" });
   const errors = details.createEl("div");
   const service = new Setting(this.contentEl).setName("Recognition service");
   const describeService = (): void => {
    const settings = options.settingsHost?.getOcrSettings();
    service.setDesc(settings ? (settings.provider === "gemini" ? "Gemini" : settings.provider === "openai" ? "Online vision service" : "Local OCR server") + " · " + (settings.model || "Choose a model in Configure") : options.provider);
   };
   describeService();
   const settingsHost = options.settingsHost;
   if (settingsHost) service.addButton(button => { configure = button; button.setButtonText("Configure").onClick(() => openOcrServiceSettings(app, settingsHost, describeService)); });
   const act = (action: OcrAction): void => { options.run(scope, action); };
   new Setting(this.contentEl).setName("Recognise handwriting").setDesc("Review the result before replacing its display. Original handwriting stays saved.")
    .addButton(button => { recognise = button; button.setButtonText("Recognise").setCta().onClick(() => act("recognise")); })
    .addButton(button => { cancel = button; button.setButtonText("Cancel").onClick(() => act("cancel")); })
    .addButton(button => { retry = button; button.setButtonText("Retry failed pages").onClick(() => act("retry")); });
   new Setting(this.contentEl).setName("Use an existing transcript").setDesc("Paste text from another app or device OCR. No recognition service is contacted.")
    .addButton(button => { paste = button; button.setButtonText("Paste transcript").onClick(() => act("paste")); });
   new Setting(this.contentEl).setName("Display").setDesc("Accepted text stays selectable in PDF exports, including when handwriting is shown.")
    .addButton(button => { ink = button; button.setButtonText("Handwriting").onClick(() => act("ink")); })
    .addButton(button => { text = button; button.setButtonText("Text").onClick(() => act("text")); });
   if (settingsHost) new Setting(this.contentEl).setName("Keep handwriting, copy text")
    .setDesc("Keep handwriting visible after recognition. Copy uses its accepted text.")
    .addToggle(toggle => { keepHandwriting = toggle; toggle.setValue(settingsHost.getOcrSettings().copyHandwritingAsText === true)
     .onChange(value => settingsHost.updateOcrSettings({ ...settingsHost.getOcrSettings(), copyHandwritingAsText: value })); });
   refresh = (): void => {
    const running = state?.running ?? options.busy;
    keepHandwriting?.setDisabled(running);
    scopeRow.setDesc(scope === "document" ? "Recognise plugin pen handwriting page by page across this PDF. Empty pages are skipped; printed or scanned page text is not included."
     : scope === "selection" ? "Only the selected pen strokes on this page."
     : options.pageStrokeCount === 0 ? "No editable pen strokes on this page. Open the PDF where you drew the handwriting."
     : options.pageStrokeCount !== undefined ? options.pageStrokeCount + " pen strokes on this page. Select strokes first to limit the area."
     : "All pen handwriting on the current page. Select strokes first to limit the area.");
    scopeControl?.setDisabled(running); configure?.setDisabled(running); recognise?.setDisabled(running || scope === "page" && options.pageStrokeCount === 0);
    cancel?.buttonEl.toggleClass("is-hidden", !running);
    retry?.buttonEl.toggleClass("is-hidden", running || !state?.failed);
    paste?.setDisabled(running || scope === "document");
    text?.setDisabled(running || !(options.canDisplay?.(scope, "text") ?? true));
    ink?.setDisabled(running || !(options.canDisplay?.(scope, "ink") ?? true));
    const seconds = state?.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
    status.setName(running ? state?.stage === "review" ? "Ready to review" : "Recognition in progress" : state?.stage === "failed" ? "Recognition needs attention" : "Status")
     .setDesc((state?.message || options.error || "Ready. Choose a scope and recognition service.") + (running ? " · " + seconds + " s elapsed" : ""));
    progress.hidden = !state?.total;
    progress.max = Math.max(1, state?.total ?? 1); progress.value = (state?.completed ?? 0) + (state?.failed ?? 0) + (state?.skipped ?? 0);
    details.hidden = !state?.errors.length; errors.textContent = state?.errors.join("\n\n") ?? "";
    if (running && this.timer === undefined) this.timer = owner?.setInterval(() => refresh(), 1000);
    else if (!running && this.timer !== undefined) { owner?.clearInterval(this.timer); this.timer = undefined; }
   };
   this.unsubscribe = options.subscribe?.(value => { state = value; if (value.running) scope = value.scope; scopeControl?.setValue(scope); refresh(); });
   refresh(); styleButtons(this.contentEl);
  }
  onClose(): void {
   closed = true;
   this.unsubscribe?.(); this.unsubscribe = undefined;
   if (this.timer !== undefined) this.contentEl.ownerDocument.defaultView?.clearInterval(this.timer);
   this.timer = undefined; this.contentEl.empty();
  }
 }
 const modal = new Options(app); modal.open();
 return () => { if (!closed) modal.close(); };
}
export function reviewOcrResult(app: App, initial: { text: string; lines: OcrLine[]; box: NormalizedRect; image?: string; pageLabel?: string; skipPage?: boolean; onOpen?: (close: () => void) => void; cancelJob?: () => void }): Promise<{ text: string; lines: OcrLine[] } | null> {
 return new Promise(resolve => {
  class Review extends Modal {
   private accepted = false;
   onOpen(): void {
    this.setTitle(initial.pageLabel ? "Review handwriting · " + initial.pageLabel : "Review recognised handwriting");
    this.modalEl?.addClass("pdf-native-annotator-dialog");
    this.contentEl.addClass("freedraw-pdf-ocr-review"); let text = initial.text;
    if (initial.image) this.contentEl.createEl("img", { attr: { src: initial.image, alt: "Original handwriting" }, cls: "freedraw-pdf-ocr-review-image" });
    new Setting(this.contentEl).setName("Transcript").setDesc("Correct the text before accepting. Original handwriting stays saved.")
     .addTextArea(control => { control.setValue(text).onChange(value => { text = value; }); control.inputEl.rows = 8; control.inputEl.setAttribute("aria-label", "Recognised transcript"); });
    const actions = new Setting(this.contentEl);
    if (initial.cancelJob) actions.addButton(button => button.setButtonText("Cancel remaining pages").onClick(() => initial.cancelJob?.()));
    actions.addButton(button => button.setButtonText(initial.skipPage ? "Skip page" : "Cancel").onClick(() => this.close()))
     .addButton(button => button.setButtonText("Accept text").setCta().onClick(() => {
      if (!text.trim() || text.length > 50000) return;
      const parts = text.trim().split("\n");
      const lines = text.trim() === initial.text.trim() ? initial.lines : parts.length === initial.lines.length ? initial.lines.map((line, index) => ({ ...line, text: parts[index] })) : [{ text: text.trim(), box: { ...initial.box } }];
      this.accepted = true; resolve({ text: text.trim(), lines }); this.close();
     }));
    styleButtons(this.contentEl); initial.onOpen?.(() => this.close());
   }
   onClose(): void { if (!this.accepted) resolve(null); this.contentEl.empty(); }
  }
  new Review(app).open();
 });
}

