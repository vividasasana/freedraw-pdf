export const RENDER_TELEMETRY_EVENT = "freedraw-pdf:render-telemetry";

export interface RenderTelemetrySnapshot {
	inputPhase: "idle" | "recording" | "committed" | "cancelled";
	inputTool: string;
	inputPage: number | null;
	pointerType: string;
	pointerEvents: number;
	inputSamples: number;
	strokePoints: number;
	inputDelayMs: number;
	lastCommittedPoints: number;
	totalStrokes: number;
	renderPhase: "idle" | "queued" | "running" | "yielded" | "publishing" | "cancelled" | "complete";
	renderPage: number | null;
	renderCompleted: number;
	renderTotal: number;
	renderJobs: number;
	renderSliceMs: number;
	renderReason: string;
	updatedAt: number;
}

const INITIAL_SNAPSHOT: RenderTelemetrySnapshot = {
	inputPhase: "idle",
	inputTool: "-",
	inputPage: null,
	pointerType: "-",
	pointerEvents: 0,
	inputSamples: 0,
	strokePoints: 0,
	inputDelayMs: 0,
	lastCommittedPoints: 0,
	totalStrokes: 0,
	renderPhase: "idle",
	renderPage: null,
	renderCompleted: 0,
	renderTotal: 0,
	renderJobs: 0,
	renderSliceMs: 0,
	renderReason: "waiting",
	updatedAt: 0
};

export class RenderTelemetryBroadcaster {
	private snapshot: RenderTelemetrySnapshot = { ...INITIAL_SNAPSHOT };
	private rootEl: HTMLDivElement | null = null;
	private inputEl: HTMLDivElement | null = null;
	private renderEl: HTMLDivElement | null = null;
	private detailEl: HTMLDivElement | null = null;
	private hostWindow: (Window & typeof globalThis) | null = null;
	private publishHandle: number | null = null;

	attach(host: HTMLElement): void {
		if (this.rootEl?.isConnected) {
			return;
		}
		this.dispose();
		this.hostWindow = host.ownerDocument.defaultView;
		this.rootEl = host.createDiv({ cls: "pdf-native-annotator-telemetry" });
		this.rootEl.setAttribute("role", "status");
		this.rootEl.setAttribute("aria-live", "off");
		this.inputEl = this.rootEl.createDiv({ cls: "pdf-native-annotator-telemetry-row is-input" });
		this.renderEl = this.rootEl.createDiv({ cls: "pdf-native-annotator-telemetry-row is-render" });
		this.detailEl = this.rootEl.createDiv({ cls: "pdf-native-annotator-telemetry-detail" });
		this.publishNow();
	}

	recordPointerDown(tool: string, page: number, event: PointerEvent): void {
		this.update({
			inputPhase: "recording",
			inputTool: tool,
			inputPage: page,
			pointerType: event.pointerType || "unknown",
			pointerEvents: 1,
			inputSamples: 1,
			strokePoints: 1,
			inputDelayMs: this.getInputDelay(event)
		});
	}

	recordPointerSamples(event: PointerEvent, sampleCount: number, strokePoints: number): void {
		this.update({
			inputPhase: "recording",
			pointerEvents: this.snapshot.pointerEvents + 1,
			inputSamples: this.snapshot.inputSamples + sampleCount,
			strokePoints,
			inputDelayMs: this.getInputDelay(event)
		});
	}

	recordPointerUp(event: PointerEvent): void {
		this.update({
			pointerEvents: this.snapshot.pointerEvents + 1,
			inputDelayMs: this.getInputDelay(event)
		});
	}

	recordStrokeCommit(pointCount: number, totalStrokes: number): void {
		this.update({
			inputPhase: "committed",
			strokePoints: pointCount,
			lastCommittedPoints: pointCount,
			totalStrokes
		});
	}

	recordInputCancelled(): void {
		this.update({ inputPhase: "cancelled" });
	}

	recordRenderQueued(page: number, totalSteps: number, activeJobs: number): void {
		this.update({
			renderPhase: "queued",
			renderPage: page,
			renderCompleted: 0,
			renderTotal: totalSteps,
			renderJobs: activeJobs,
			renderSliceMs: 0,
			renderReason: "scheduled"
		});
	}

	recordRenderProgress(
		page: number,
		completed: number,
		total: number,
		activeJobs: number,
		sliceMs: number,
		inputPending: boolean
	): void {
		this.update({
			renderPhase: inputPending ? "yielded" : "running",
			renderPage: page,
			renderCompleted: completed,
			renderTotal: total,
			renderJobs: activeJobs,
			renderSliceMs: sliceMs,
			renderReason: inputPending ? "input pending" : "rendering"
		});
	}

	recordRenderComplete(page: number): void {
		this.update({
			renderPhase: "complete",
			renderPage: page,
			renderCompleted: this.snapshot.renderTotal,
			renderJobs: Math.max(0, this.snapshot.renderJobs - 1),
			renderReason: "atomic swap complete"
		});
	}

	recordRenderPublishing(page: number, activeJobs: number): void {
		this.update({
			renderPhase: "publishing",
			renderPage: page,
			renderCompleted: this.snapshot.renderTotal,
			renderJobs: activeJobs,
			renderReason: "snapshotting off the input path"
		});
	}

	recordRenderCancelled(reason: string, activeJobs = 0): void {
		this.update({
			renderPhase: "cancelled",
			renderJobs: activeJobs,
			renderReason: reason
		});
	}

	recordRenderIdle(reason: string): void {
		this.update({
			renderPhase: "idle",
			renderPage: null,
			renderCompleted: 0,
			renderTotal: 0,
			renderJobs: 0,
			renderSliceMs: 0,
			renderReason: reason
		});
	}

	dispose(): void {
		if (this.publishHandle !== null && this.hostWindow) {
			this.hostWindow.cancelAnimationFrame(this.publishHandle);
		}
		this.publishHandle = null;
		this.rootEl?.remove();
		this.rootEl = null;
		this.inputEl = null;
		this.renderEl = null;
		this.detailEl = null;
		this.hostWindow = null;
	}

	private getInputDelay(event: PointerEvent): number {
		const now = this.hostWindow?.performance.now() ?? performance.now();
		if (!Number.isFinite(event.timeStamp) || event.timeStamp <= 0) {
			return 0;
		}
		return Math.max(0, now - event.timeStamp);
	}

	private update(update: Partial<RenderTelemetrySnapshot>): void {
		this.snapshot = {
			...this.snapshot,
			...update,
			updatedAt: this.hostWindow?.performance.now() ?? performance.now()
		};
		if (!this.hostWindow || this.publishHandle !== null) {
			return;
		}
		this.publishHandle = this.hostWindow.requestAnimationFrame(() => {
			this.publishHandle = null;
			this.publishNow();
		});
	}

	private publishNow(): void {
		if (!this.rootEl || !this.inputEl || !this.renderEl || !this.detailEl) {
			return;
		}
		const inputPage = this.snapshot.inputPage ? ` p${this.snapshot.inputPage}` : "";
		const renderPage = this.snapshot.renderPage ? ` p${this.snapshot.renderPage}` : "";
		this.inputEl.textContent =
			`INPUT ${this.snapshot.inputPhase.toUpperCase()}${inputPage} | ${this.snapshot.strokePoints} pts | ${this.snapshot.pointerEvents} events | ${this.snapshot.inputDelayMs.toFixed(1)} ms delay`;
		this.renderEl.textContent =
			`RENDER ${this.snapshot.renderPhase.toUpperCase()}${renderPage} | ${this.snapshot.renderCompleted}/${this.snapshot.renderTotal} | ${this.snapshot.renderJobs} jobs`;
		this.detailEl.textContent =
			`${this.snapshot.inputTool}/${this.snapshot.pointerType} | ${this.snapshot.inputSamples} samples | slice ${this.snapshot.renderSliceMs.toFixed(1)} ms | ${this.snapshot.renderReason}`;
		this.rootEl.dataset.inputPhase = this.snapshot.inputPhase;
		this.rootEl.dataset.renderPhase = this.snapshot.renderPhase;
		if (this.hostWindow) {
			this.hostWindow.dispatchEvent(new this.hostWindow.CustomEvent(RENDER_TELEMETRY_EVENT, {
				detail: { ...this.snapshot }
			}));
		}
	}
}
