import { App, MarkdownView, Menu, Notice, TFile } from "obsidian";
import { LRUCache } from "../utils/lruCache";
import { clamp, generateId } from "../utils/general";
import { normalizeRect } from "../annotation/interaction";
import { getNotebookPageSizeDimensions, hasEditableNativePageTemplates } from "../notebook/pageModel";
import { drawTemplatePageBackground } from "../notebook/templateCanvas";
import { getNativePdfJs } from "../pdf/nativePdfJs";
import { cloneCanvas, cropCanvasToNormalizedRect, formatAnnotatedPdfEmbedBlock, parseAnnotatedPdfEmbedSource, renderAnnotationDocumentPage, renderAnnotationDocumentPageImages } from "./embedRender";
import type { AnnotationStore } from "../stores/annotationStore";
import type { AnnotatedMarkdownEmbedInstance, NormalizedRect } from "../types";

export interface AnnotatedEmbedHost {
	shouldShowAnnotatedEmbedHeader(): boolean;
	openPdfPage(file: TFile, pageNumber: number, rect?: NormalizedRect | null): Promise<void>;
	writeClipboardText(text: string): Promise<void>;
}

export class AnnotatedEmbedController {
	private readonly renderCache = new LRUCache<string, HTMLCanvasElement>(16);
	private readonly instances = new Map<string, AnnotatedMarkdownEmbedInstance>();

	constructor(
		private readonly app: App,
		private readonly store: AnnotationStore,
		private readonly host: AnnotatedEmbedHost
	) {}

	buildBlock(file: TFile, page: number, rect?: NormalizedRect | null, width = 720): string {
		return formatAnnotatedPdfEmbedBlock(file.path, page, rect, width);
	}

	async copyBlock(file: TFile, page: number, rect?: NormalizedRect | null): Promise<void> {
		const block = this.buildBlock(file, page, rect);
		try {
			await this.host.writeClipboardText(block);
			new Notice(rect ? `Copied annotated region embed for ${file.name} page ${page}.` : `Copied annotated embed for ${file.name} page ${page}.`);
		} catch (error) {
			console.error("freedraw-pdf: failed to copy annotated embed block", error);
			new Notice(`Copy failed. Embed block: ${block}`);
		}
	}

	insertBlock(markdownView: MarkdownView, file: TFile, page: number, rect?: NormalizedRect | null): void {
		const editor = markdownView.editor;
		const block = this.buildBlock(file, page, rect);
		const prefix = editor.getCursor().ch === 0 ? "" : "\n";
		editor.replaceSelection(`${prefix}${block}\n`);
		new Notice(rect ? `Inserted annotated region embed for ${file.name} page ${page}.` : `Inserted annotated embed for ${file.name} page ${page}.`);
	}

	refreshForPath(path: string): void {
		for (const [id, instance] of Array.from(this.instances.entries())) {
			if (!instance.el.isConnected) {
				this.instances.delete(id);
				continue;
			}
			if (path === instance.filePath || path === instance.sidecarPath) {
				instance.render(true);
			}
		}
	}

	async renderMarkdownBlock(source: string, el: HTMLElement, sourcePath: string): Promise<void> {
		el.empty();
		const config = parseAnnotatedPdfEmbedSource(source);
		const wrapper = el.createDiv({ cls: "freedraw-pdf-markdown-embed" });
		const showHeader = this.host.shouldShowAnnotatedEmbedHeader();
		wrapper.classList.toggle("is-header-hidden", !showHeader);
		const header = showHeader ? wrapper.createDiv({ cls: "freedraw-pdf-markdown-embed-header" }) : null;
		const title = header?.createDiv({ cls: "freedraw-pdf-markdown-embed-title", text: "Annotated PDF page" }) ?? null;
		const actions = header?.createDiv({ cls: "freedraw-pdf-markdown-embed-actions" }) ?? null;
		if (!config.path) {
			wrapper.createDiv({ cls: "freedraw-pdf-markdown-embed-error", text: "Missing `path:` in freedraw-pdf block." });
			return;
		}
		const file = this.resolveFile(config.path, sourcePath);
		if (!file) {
			wrapper.createDiv({ cls: "freedraw-pdf-markdown-embed-error", text: `Could not find PDF: ${config.path}` });
			return;
		}
		if (title) {
			title.textContent = config.rect ? `${file.name} - page ${config.page} region` : `${file.name} - page ${config.page}`;
		}
		wrapper.title = config.rect
			? "Double-click to open this annotated region. Right-click for actions."
			: "Double-click to open this annotated page. Right-click for actions.";
		const body = wrapper.createDiv({ cls: "freedraw-pdf-markdown-embed-body" });
		let renderVersion = 0;
		const render = (forceRefresh = false): void => {
			const version = ++renderVersion;
			body.empty();
			body.createDiv({ cls: "freedraw-pdf-markdown-embed-loading", text: forceRefresh ? "Refreshing annotated page..." : "Rendering annotated page..." });
			void this.renderPageToCanvas(file, config.page, config.width, config.rect, forceRefresh)
				.then((canvas) => {
					if (version !== renderVersion || !wrapper.isConnected) {
						return;
					}
					body.empty();
					canvas.className = "freedraw-pdf-markdown-embed-canvas";
					canvas.setCssStyles({
						maxWidth: "100%",
						height: "auto"
					});
					body.appendChild(canvas);
				})
				.catch((error) => {
					if (version !== renderVersion || !wrapper.isConnected) {
						return;
					}
					console.error("freedraw-pdf: failed to render annotated markdown embed", error);
					body.empty();
					body.createDiv({ cls: "freedraw-pdf-markdown-embed-error", text: error instanceof Error ? error.message : "Could not render annotated PDF page." });
				});
		};
		wrapper.addEventListener("dblclick", (event) => {
			event.preventDefault();
			void this.host.openPdfPage(file, config.page, config.rect);
		});
		wrapper.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openEmbedContextMenu(event, file, config.page, config.rect, render);
		});
		if (actions) {
			const openButton = actions.createEl("button", { type: "button", text: "Open", cls: "freedraw-pdf-markdown-embed-action" });
			openButton.addEventListener("click", () => void this.host.openPdfPage(file, config.page, config.rect));
			const refreshButton = actions.createEl("button", { type: "button", text: "Refresh", cls: "freedraw-pdf-markdown-embed-action" });
			refreshButton.addEventListener("click", () => render(true));
			const copyButton = actions.createEl("button", { type: "button", text: "Copy block", cls: "freedraw-pdf-markdown-embed-action" });
			copyButton.addEventListener("click", () => void this.copyBlock(file, config.page, config.rect));
		}
		const instanceId = generateId("embed");
		this.instances.set(instanceId, {
			id: instanceId,
			filePath: file.path,
			sidecarPath: this.store.getSidecarPath(file),
			el: wrapper,
			render
		});
		render(false);
	}

	private openEmbedContextMenu(
		event: MouseEvent,
		file: TFile,
		page: number,
		rect: NormalizedRect | null,
		render: (forceRefresh?: boolean) => void
	): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(rect ? "Open annotated region" : "Open annotated page")
			.setIcon("file-text")
			.onClick(() => void this.host.openPdfPage(file, page, rect)));
		menu.addItem((item) => item
			.setTitle("Refresh preview")
			.setIcon("refresh-cw")
			.onClick(() => render(true)));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Copy embed block")
			.setIcon("code")
			.onClick(() => void this.copyBlock(file, page, rect)));
		menu.addItem((item) => item
			.setTitle(rect ? "Copy region reference" : "Copy page link")
			.setIcon("link")
			.onClick(() => void this.copyReference(file, page, rect)));
		menu.showAtPosition({ x: event.clientX, y: event.clientY });
	}

	private async copyReference(file: TFile, page: number, rect: NormalizedRect | null): Promise<void> {
		const reference = rect
			? `[[${file.path}#page=${page}]] ::region[page=${page};rect=${[rect.left, rect.top, rect.right, rect.bottom].map((value) => value.toFixed(4)).join(",")}]`
			: `[[${file.path}#page=${page}]]`;
		try {
			await this.host.writeClipboardText(reference);
			new Notice(rect ? "Copied region reference." : `Copied page ${page} link.`);
		} catch (error) {
			console.error("freedraw-pdf: failed to copy embed reference", error);
			new Notice(`Copy failed. Reference: ${reference}`);
		}
	}

	private resolveFile(rawPath: string, sourcePath: string): TFile | null {
		const cleanPath = rawPath.split("#")[0]?.trim();
		if (!cleanPath) {
			return null;
		}
		const direct = this.app.vault.getAbstractFileByPath(cleanPath);
		if (direct instanceof TFile && direct.extension.toLowerCase() === "pdf") {
			return direct;
		}
		const linked = this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
		return linked instanceof TFile && linked.extension.toLowerCase() === "pdf" ? linked : null;
	}

	private async renderPageToCanvas(file: TFile, pageNumber: number, targetWidth: number, rect: NormalizedRect | null = null, forceRefresh = false): Promise<HTMLCanvasElement> {
		const annotationDocument = await this.store.load(file);
		const rectKey = rect ? `${rect.left.toFixed(4)},${rect.top.toFixed(4)},${rect.right.toFixed(4)},${rect.bottom.toFixed(4)}` : "full";
		const normalizedRect = rect ? normalizeRect(rect) : null;
		const rectWidth = normalizedRect ? Math.max(0.12, normalizedRect.right - normalizedRect.left) : 1;
		const renderWidth = normalizedRect
			? clamp(Math.round(targetWidth / rectWidth), targetWidth, 2600)
			: targetWidth;
		const cacheKey = `${file.path}:${pageNumber}:${targetWidth}:${renderWidth}:${rectKey}:${annotationDocument.updatedAt}`;
		if (!forceRefresh) {
			const cached = this.renderCache.get(cacheKey);
			if (cached) {
				return cloneCanvas(cached);
			}
		}
		const binary = await this.app.vault.adapter.readBinary(file.path);
		const pdfjsLib = getNativePdfJs();
		const loadingTask = pdfjsLib.getDocument({
			data: new Uint8Array(binary),
			disableWorker: true,
			isEvalSupported: false,
			useWorkerFetch: false
		});
		try {
			const pdfDocument = await loadingTask.promise;
			if (pageNumber <= pdfDocument.numPages) {
				const pdfPage = await pdfDocument.getPage(pageNumber);
				const baseViewport = pdfPage.getViewport({ scale: 1 });
				const scale = renderWidth / Math.max(baseViewport.width, 1);
				const viewport = pdfPage.getViewport({ scale });
				const canvas = createEl("canvas");
				canvas.width = Math.max(1, Math.round(viewport.width));
				canvas.height = Math.max(1, Math.round(viewport.height));
				const context = canvas.getContext("2d");
				if (!context) {
					throw new Error("Could not create embed canvas.");
				}
				context.fillStyle = "#ffffff";
				context.fillRect(0, 0, canvas.width, canvas.height);
				await pdfPage.render({ canvasContext: context, viewport }).promise;
				const pageTemplate = hasEditableNativePageTemplates(annotationDocument, pdfDocument.numPages)
					? annotationDocument.pdfPageTemplates?.find((template) => template.page === pageNumber)
					: null;
				if (pageTemplate) {
					drawTemplatePageBackground(context, canvas.width, canvas.height, {
						id: `pdf-template-${pageNumber}`,
						title: `Page ${pageNumber}`,
						kind: "template",
						template: pageTemplate.template,
						paperColor: pageTemplate.paperColor,
						pageSize: pageTemplate.pageSize,
						strokes: [],
						textItems: [],
						shapes: []
					});
				}
				await renderAnnotationDocumentPageImages(context, annotationDocument, pageNumber, canvas.width, canvas.height);
				renderAnnotationDocumentPage(context, annotationDocument, pageNumber, canvas.width, canvas.height);
				await pdfDocument.destroy();
				const outputCanvas = normalizedRect ? cropCanvasToNormalizedRect(canvas, normalizedRect) : canvas;
				this.renderCache.set(cacheKey, cloneCanvas(outputCanvas));
				return outputCanvas;
			}
			const syntheticIndex = pageNumber - pdfDocument.numPages - 1;
			const syntheticPage = annotationDocument.appendedPages?.[syntheticIndex];
			if (!syntheticPage) {
				throw new Error(`Page ${pageNumber} is outside this PDF annotation session.`);
			}
			const dimensions = getNotebookPageSizeDimensions(syntheticPage.pageSize);
			const canvas = createEl("canvas");
			canvas.width = renderWidth;
			canvas.height = Math.max(1, Math.round(renderWidth * dimensions.height / Math.max(dimensions.width, 1)));
			const context = canvas.getContext("2d");
			if (!context) {
				throw new Error("Could not create embed canvas.");
			}
			drawTemplatePageBackground(context, canvas.width, canvas.height, syntheticPage);
			await renderAnnotationDocumentPageImages(context, annotationDocument, pageNumber, canvas.width, canvas.height);
			renderAnnotationDocumentPage(context, annotationDocument, pageNumber, canvas.width, canvas.height);
			await pdfDocument.destroy();
			const outputCanvas = normalizedRect ? cropCanvasToNormalizedRect(canvas, normalizedRect) : canvas;
			this.renderCache.set(cacheKey, cloneCanvas(outputCanvas));
			return outputCanvas;
		} finally {
			await loadingTask.destroy();
		}
	}
}
