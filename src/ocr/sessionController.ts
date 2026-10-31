import type { App } from "obsidian";
import type { AnnotationDocument, StrokeAnnotation } from "../types";
import { ocrFingerprint, ocrSourceSnapshot, type OcrSettings, type OcrGroup } from "./model";
import { openOcrOptions, reviewOcrResult, type OcrAction, type OcrScope, type OcrProgressState } from "./dialogs";
import { createOcrInput } from "./input";
import { ocrEndpoint, OcrServiceError, type OcrTransport, type OcrResult } from "./providers";
import { recogniseInkWithRetry } from "./retry";
import type { OcrSettingsHost } from "./settingsRows";
import { generateId } from "../utils/general";

export interface OcrCapture { document: AnnotationDocument; filePath: string; page: number; strokes: StrokeAnnotation[]; aspect: number; }
export interface OcrSessionHost {
 app: App; owner: Window; capture: (scope: OcrScope) => OcrCapture | null; isCurrent: (capture: OcrCapture) => boolean;
 capturePages?: () => OcrCapture[];
 settings: () => OcrSettings; credential: () => string; transport: OcrTransport; settingsHost?: OcrSettingsHost;
 beforeChange: () => void; changed: (page: number) => void; notice: (message: string) => void; stateChanged?: () => void;
}
export class OcrSessionController {
 private generation = 0;
 private busy = false;
 private closeOptions: (() => void) | undefined;
 private closeReview: (() => void) | undefined;
 private stopWaiting: (() => void) | undefined;
 private failedCaptures: OcrCapture[] = [];
 private readonly listeners = new Set<(state: OcrProgressState) => void>();
 private state: OcrProgressState = { stage: "idle", running: false, scope: "page", total: 0, index: 0, completed: 0, failed: 0, skipped: 0, startedAt: 0, message: "Choose handwriting to recognise. Original strokes remain saved.", errors: [] };
 constructor(private readonly host: OcrSessionHost) {}
 get isBusy(): boolean { return this.busy; }
 private update(patch: Partial<OcrProgressState>): void {
  this.state = { ...this.state, ...patch, running: this.busy };
  for (const listener of this.listeners) listener(this.state);
  this.host.stateChanged?.();
 }
 cancel(): void {
  const wasBusy = this.busy;
  this.generation++; this.busy = false;
  this.stopWaiting?.(); this.stopWaiting = undefined;
  this.closeReview?.(); this.closeReview = undefined;
  if (wasBusy) this.update({ stage: "cancelled", message: "Cancelled. Previously accepted pages and original handwriting are kept." });
 }
 dispose(): void {
  this.cancel(); this.closeOptions?.(); this.closeReview?.(); this.listeners.clear();
 }
 private captures(scope: OcrScope): OcrCapture[] {
  return scope === "document" ? this.host.capturePages?.() ?? [] : [this.host.capture(scope)].filter((value): value is OcrCapture => !!value);
 }
 private groups(capture: OcrCapture, scope: OcrScope): OcrGroup[] {
  const ids = new Set(capture.strokes.map(stroke => stroke.id));
  return (capture.document.ocrGroups ?? []).filter(group => group.page === capture.page && (scope !== "selection" || group.strokeIds.some(id => ids.has(id))));
 }
 private validGroup(capture: OcrCapture, group: OcrGroup): boolean {
  const ids = new Set(group.strokeIds), source = capture.document.strokes.filter(stroke => stroke.page === group.page && ids.has(stroke.id));
  return source.length === ids.size && ocrFingerprint(ocrSourceSnapshot(source)) === group.sourceFingerprint;
 }
 open(error?: string): void {
  const pageCapture = this.host.capture("page");
  if (!pageCapture) { this.host.notice("Open a PDF first."); return; }
  this.closeOptions?.();
  const settings = this.host.settings();
  this.closeOptions = openOcrOptions(this.host.app, {
   selectedCount: this.host.capture("selection")?.strokes.length ?? 0, pageStrokeCount: pageCapture.strokes.length, pageCount: this.host.capturePages?.().length ?? 0,
   provider: settings.provider === "gemini" ? "Gemini" : settings.provider === "openai" ? "OpenAI-compatible vision" : "Local OCR server",
   busy: this.busy, state: this.state, initialScope: this.state.scope, settingsHost: this.host.settingsHost, error,
   canDisplay: (scope, mode) => this.captures(scope).some(capture => this.groups(capture, scope).some(group => mode === "ink" || this.validGroup(capture, group))),
   subscribe: listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
   run: (scope, action) => { void this.run(scope, action); }
  });
 }
 private unchanged(capture: OcrCapture, snapshot: string): boolean {
  if (!this.host.isCurrent(capture)) return false;
  const ids = new Set(capture.strokes.map(stroke => stroke.id)), current = capture.document.strokes.filter(stroke => stroke.page === capture.page && ids.has(stroke.id));
  return current.length === capture.strokes.length && ocrSourceSnapshot(current) === snapshot;
 }
 private changeDisplay(scope: OcrScope, mode: "text" | "ink"): void {
  const edits = this.captures(scope).map(capture => ({ capture, groups: this.groups(capture, scope).filter(group => mode === "ink" || this.validGroup(capture, group)) })).filter(edit => edit.groups.length);
  if (!edits.length) { this.host.notice("No accepted recognition result for this scope. Recognise and review the handwriting first."); return; }
  this.host.beforeChange();
  for (const { capture, groups } of edits) { for (const group of groups) group.mode = mode; this.host.changed(capture.page); }
  this.update({ message: (mode === "text" ? "Selectable text" : "Original handwriting") + " shown on " + edits.length + " pages." });
 }
 async run(scope: OcrScope, action: OcrAction): Promise<void> {
  if (action === "cancel") { this.cancel(); return; }
  // A display request must never invalidate an in-flight recognition token.
  if (this.busy) { this.host.notice("Recognition is still running. Follow its progress in OCR options, or choose Cancel."); return; }
  if (action === "text" || action === "ink") { this.changeDisplay(scope, action); return; }
  if (action === "retry") scope = this.state.scope;
  let queue = action === "retry" ? this.failedCaptures.map(capture => {
   const ids = new Set(capture.strokes.map(stroke => stroke.id));
   return { ...capture, strokes: capture.document.strokes.filter(stroke => stroke.page === capture.page && stroke.tool === "pen" && ids.has(stroke.id)) };
  }) : this.captures(scope);
  queue = queue.filter(capture => capture.strokes.length && this.host.isCurrent(capture));
  if (!queue.length) { this.host.notice(scope === "selection" ? "Select pen handwriting first." : "There is no pen handwriting in this scope."); return; }
  if (action === "paste" && scope === "document") { this.host.notice("Paste a transcript for a selection or one page. Whole PDF processes pages separately."); return; }
  const batch = scope === "document" || queue.length > 1, token = ++this.generation, settings = { ...this.host.settings() }, credential = this.host.credential();
  this.busy = true; this.failedCaptures = [];
  this.update({ stage: "preparing", scope, total: queue.length, index: 0, completed: 0, failed: 0, skipped: 0, startedAt: Date.now(), message: "Preparing handwriting…", errors: [] });
  try {
   if (action !== "paste") { ocrEndpoint(settings); if (settings.provider !== "local" && !credential) throw new Error("Add your OCR API key in Service options first."); }
   for (let index = 0; index < queue.length; index++) {
    if (token !== this.generation) return;
    const capture = queue[index];
    if (!this.host.isCurrent(capture)) { this.cancel(); return; }
    const snapshot = ocrSourceSnapshot(capture.strokes), pageLabel = "Page " + capture.page + " · " + (index + 1) + " of " + queue.length;
    this.update({ stage: "preparing", index: index + 1, page: capture.page, message: "Preparing " + pageLabel.toLowerCase() + "…" });
    try {
     const source = JSON.parse(JSON.stringify(capture.strokes)) as StrokeAnnotation[];
     const input = await createOcrInput(this.host.owner, source, capture.aspect, () => token === this.generation && this.host.isCurrent(capture));
     let result: OcrResult = { text: "", lines: [] };
     if (action !== "paste") {
      this.update({ stage: "recognising", message: "Recognising " + pageLabel.toLowerCase() + "…" });
      let timeout: number | undefined, stopWait: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => { stopWait = () => reject(new Error("Recognition cancelled.")); });
      this.stopWaiting = stopWait;
      try { result = await Promise.race([recogniseInkWithRetry(settings, credential, input.image, input.box, this.host.transport, this.host.owner, () => token === this.generation && this.unchanged(capture, snapshot), (attempt, delay, status) => {
       if (token === this.generation) this.update({ message: "Service temporarily unavailable (HTTP " + status + "). Retry " + attempt + " of 2 in " + Math.ceil(delay / 1000) + " seconds…" });
      }), cancellation,
       new Promise<never>((_resolve, reject) => { timeout = this.host.owner.setTimeout(() => reject(new Error("The service did not finish within 90 seconds. Try a smaller selection or another available model.")), 90000); })]); }
      finally { if (timeout !== undefined) this.host.owner.clearTimeout(timeout); if (this.stopWaiting === stopWait) this.stopWaiting = undefined; }
     }
     if (token !== this.generation) return;
     if (!this.unchanged(capture, snapshot)) throw new Error("The source handwriting changed. Its recognition result was not applied.");
     this.update({ stage: "review", message: pageLabel + " is ready to review." });
     this.closeOptions?.();
     const accepted = await reviewOcrResult(this.host.app, { ...result, box: input.box, image: input.image, pageLabel, skipPage: batch,
      onOpen: close => { this.closeReview = close; }, cancelJob: batch ? () => { this.cancel(); this.open(); } : undefined });
     this.closeReview = undefined;
     if (token !== this.generation) return;
     if (accepted) {
      if (!this.unchanged(capture, snapshot)) throw new Error("The handwriting changed while reviewing. Nothing was replaced.");
      this.host.beforeChange();
      const ids = new Set(source.map(stroke => stroke.id));
      const group: OcrGroup = { id: generateId("ocr"), page: capture.page, strokeIds: [...ids], sourceFingerprint: ocrFingerprint(snapshot), ...accepted, mode: settings.copyHandwritingAsText ? "ink" : "text", provider: action === "paste" ? "Pasted transcript" : settings.provider + ":" + settings.model, createdAt: new Date().toISOString() };
      capture.document.ocrGroups = [...(capture.document.ocrGroups ?? []).filter(group => !group.strokeIds.some(id => ids.has(id))), group];
      this.host.changed(capture.page); this.update({ completed: this.state.completed + 1 });
     } else this.update({ skipped: this.state.skipped + 1 });
    } catch (error) {
     if (token !== this.generation) return;
     const message = error instanceof Error ? error.message : "Recognition failed.";
     this.failedCaptures.push(capture);
     this.update({ failed: this.state.failed + 1, errors: [...this.state.errors, "Page " + capture.page + ": " + message], message });
     // Stop an invalid-account/model batch instead of repeatedly sending handwriting.
     if (error instanceof OcrServiceError && [400, 401, 403, 404, 408, 429, 500, 502, 503, 504].includes(error.status)) {
      this.failedCaptures.push(...queue.slice(index + 1)); this.update({ failed: this.state.failed + queue.length - index - 1 }); break;
     }
    }
    if (token === this.generation && index < queue.length - 1) this.open();
   }
   if (token !== this.generation) return;
   this.busy = false;
   const summary = this.state.completed + " pages applied, " + this.state.skipped + " skipped, " + this.state.failed + " failed or not processed.";
   this.update({ stage: this.state.failed ? "failed" : "completed", message: summary + (this.state.errors.length ? "\n" + this.state.errors[0] : "") });
   if (this.state.failed || !this.state.completed) this.open();
   else { this.closeOptions?.(); this.closeOptions = undefined; }
  } catch (error) {
   if (token === this.generation) {
    const message = error instanceof Error ? error.message : "Recognition could not start.";
    this.failedCaptures = queue; this.busy = false;
    this.update({ stage: "failed", failed: queue.length, message, errors: [message] }); this.open(message);
   }
  } finally { if (token === this.generation) { this.busy = false; this.update({ running: false }); } }
 }
}

