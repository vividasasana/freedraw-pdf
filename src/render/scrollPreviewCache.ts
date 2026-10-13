export interface ScrollPreviewSnapshot {
	href: string;
	width: number;
	height: number;
	bytes: number;
	dispose(): void;
}

type SnapshotFactory = (root: SVGSVGElement, body: SVGGElement, width: number, height: number) => Promise<ScrollPreviewSnapshot>;
interface Entry {
	body: SVGGElement;
	image: SVGImageElement;
	snapshot: ScrollPreviewSnapshot;
	epoch: number;
	ready: boolean;
	requested: boolean;
	used: number;
}

/** A small, disposable display cache. Annotation geometry remains in the SVG. */
export class ScrollPreviewCache {
	private readonly entries = new Map<SVGSVGElement, Entry>();
	private readonly epochs = new WeakMap<SVGSVGElement, number>();
	private pending: SVGSVGElement | null = null;
	private clock = 0;
	constructor(private readonly snapshotFactory: SnapshotFactory = rasterizeSvgBody,
		private readonly maxBytes = 12 * 1024 * 1024, private readonly maxPages = 2) {}

	async prepare(root: SVGSVGElement, body: SVGGElement, width: number, height: number, isCurrent: () => boolean): Promise<boolean> {
		if (!root.isConnected || !isCurrent()) return false;
		if (this.entries.has(root)) return true;
		if (this.pending) return false;
		const epoch = this.epochs.get(root) ?? 0;
		this.pending = root;
		let snapshot: ScrollPreviewSnapshot | null = null;
		try {
			snapshot = await this.snapshotFactory(root, body, width, height);
			if ((this.epochs.get(root) ?? 0) !== epoch || !root.isConnected || !isCurrent() || snapshot.bytes > this.maxBytes) return false;
			const image = root.createSvg("image", { cls: "freedraw-pdf-scroll-preview", attr: {
				x: 0, y: 0, width, height, preserveAspectRatio: "none", "aria-hidden": "true"
			} });
			root.insertBefore(image, body.nextSibling);
			const entry: Entry = { body, image, snapshot, epoch, ready: false, requested: false, used: ++this.clock };
			this.entries.set(root, entry);
			snapshot = null; // The entry owns disposal from this point onward.
			image.addEventListener("load", () => {
				if (this.entries.get(root) !== entry) return;
				entry.ready = true;
				if (entry.requested) this.show(root);
			}, { once: true });
			image.addEventListener("error", () => {
				if (this.entries.get(root) === entry) this.invalidate(root);
			}, { once: true });
			image.setAttribute("href", entry.snapshot.href);
			this.trim();
			return this.entries.has(root);
		} catch {
			// Unsupported SVG-to-image conversion must leave the exact SVG visible.
			return false;
		} finally {
			snapshot?.dispose();
			this.pending = null;
		}
	}

	show(root: SVGSVGElement): boolean {
		const entry = this.entries.get(root);
		if (!entry) return false;
		entry.requested = true;
		entry.used = ++this.clock;
		if (!entry.ready) return false;
		entry.image.classList.add("is-active");
		entry.body.classList.add("freedraw-pdf-scroll-preview-hidden");
		return true;
	}

	hideAll(): void { for (const entry of this.entries.values()) this.hide(entry); }
	invalidate(root: SVGSVGElement): void {
		this.epochs.set(root, (this.epochs.get(root) ?? 0) + 1);
		const entry = this.entries.get(root);
		if (entry) {
			this.hide(entry);
			entry.image.remove();
			entry.snapshot.dispose();
			this.entries.delete(root);
		}
	}
	clear(): void {
		for (const root of [...this.entries.keys()]) this.invalidate(root);
		if (this.pending) this.invalidate(this.pending);
	}
	private hide(entry: Entry): void {
		entry.requested = false;
		entry.body.classList.remove("freedraw-pdf-scroll-preview-hidden");
		entry.image.classList.remove("is-active");
	}
	private trim(): void {
		let bytes = [...this.entries.values()].reduce((total, entry) => total + entry.snapshot.bytes, 0);
		while (bytes > this.maxBytes || this.entries.size > this.maxPages) {
			const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used)[0];
			if (!oldest) break;
			bytes -= oldest[1].snapshot.bytes;
			this.invalidate(oldest[0]);
		}
	}
}

async function rasterizeSvgBody(root: SVGSVGElement, body: SVGGElement, width: number, height: number): Promise<ScrollPreviewSnapshot> {
	const host = root.ownerDocument.defaultView;
	if (!host || width <= 0 || height <= 0) throw new Error("Annotation preview window unavailable");
	const ratio = Math.min(1, 1024 / width, 1024 / height, Math.sqrt((512 * 1024) / (width * height)));
	const pixelWidth = Math.max(1, Math.floor(width * ratio)), pixelHeight = Math.max(1, Math.floor(height * ratio));
	// Bound copying/serialization before cloning a potentially enormous SVG tree.
	const walker = root.ownerDocument.createTreeWalker(body, host.NodeFilter.SHOW_ELEMENT);
	let count = 0, characters = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const element = node as Element;
		characters += Array.from(element.attributes).reduce((sum, attribute) => sum + attribute.value.length + attribute.name.length + 8, 0);
		if (element.localName === "text") characters += element.textContent?.length ?? 0;
		if (++count > 12000 || characters > 4 * 1024 * 1024) throw new Error("Annotation preview exceeds copy budget");
	}
	const svg = host.createFragment().createSvg("svg", { attr: {
		xmlns: "http://www.w3.org/2000/svg", width: pixelWidth, height: pixelHeight,
		viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none"
	} });
	svg.appendChild(body.cloneNode(true));
	const markup = new host.XMLSerializer().serializeToString(svg);
	if (markup.length > 4 * 1024 * 1024) throw new Error("Annotation preview exceeds serialization budget");
	const sourceUrl = host.URL.createObjectURL(new host.Blob([markup], { type: "image/svg+xml" }));
	const image = new host.Image();
	const canvas = host.createEl("canvas");
	let outputUrl: string | null = null;
	try {
		image.src = sourceUrl;
		await image.decode();
		canvas.width = pixelWidth; canvas.height = pixelHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Annotation preview canvas unavailable");
		context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
			if (value) resolve(value); else reject(new Error("Annotation preview encoding failed"));
		}, "image/png"));
		outputUrl = host.URL.createObjectURL(blob);
		const href = outputUrl;
		return { href, width: pixelWidth, height: pixelHeight, bytes: pixelWidth * pixelHeight * 8 + blob.size,
			dispose: () => host.URL.revokeObjectURL(href) };
	} catch (error) {
		if (outputUrl) host.URL.revokeObjectURL(outputUrl);
		throw error;
	} finally {
		image.src = "";
		host.URL.revokeObjectURL(sourceUrl);
		canvas.width = 1; canvas.height = 1;
	}
}
