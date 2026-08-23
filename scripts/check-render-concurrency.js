const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function busyWait(durationMs) {
	const deadline = performance.now() + durationMs;
	while (performance.now() < deadline) {
		// Simulate one non-interruptible stroke geometry calculation.
	}
}

async function main() {
	const source = fs.readFileSync(path.join(projectRoot, "src", "render", "cooperativeRender.ts"), "utf8");
	const mainSource = fs.readFileSync(path.join(projectRoot, "main.ts"), "utf8");
	assert(mainSource.includes("const allowInputYield = sliceStart - job.lastProgressAt < 48;"), "render scheduler must bound browser-input starvation");
	assert(mainSource.includes("job.lastProgressAt = performance.now();"), "render scheduler must track successful progress");
	assert(mainSource.includes("const canSwap = !allowInputYield ||"), "render scheduler must eventually swap a completed canvas");
	assert(mainSource.includes("scheduling?.isInputPending?.() ?? false"), "render scheduler must query discrete pending input");
	assert(!mainSource.includes("includeContinuous: true"), "continuous touch input must not keep rendering pending forever");
	assert(mainSource.includes("await this.createCanvasSnapshot(job.canvas)"), "completed renders must snapshot asynchronously");
	assert(mainSource.includes("this.resizeOverlay(surface, true);"), "zoom rendering must preserve the last visible frame until publication");
	assert(mainSource.includes("this.syncCanvasBackingSize(surface.overlayEl, job.width, job.height);"), "publication must size the visible canvas only when the replacement frame is ready");
	assert(mainSource.includes("this.syncCanvasBackingSize(surface.transientEl, surface.lastWidth, surface.lastHeight);"), "live strokes must use the current zoom backing size");
	assert(mainSource.includes("this.syncCanvasBackingSize(surface.overlayEl, surface.lastWidth, surface.lastHeight, true);"), "a stroke committed during zoom must preserve and resize the visible frame");
	assert(!mainSource.includes('surface.overlayEl.setCssStyles({ opacity: "0.96" });'), "zoom must not fade otherwise stable strokes");
	assert(mainSource.includes("Math.abs(viewport.scale - 1) < 0.05"), "pinch zoom must not trigger keyboard-only text recentering");
	assert(!mainSource.includes("this.publishRenderedCanvas(job.canvas, surface.overlayEl);"), "background render publication must not perform a synchronous full-frame copy");
	assert(mainSource.includes("this.renderInputEpoch === job.inputEpoch"), "touch input must invalidate stale render publications");
	assert(mainSource.includes("this.cancelPendingInteractionRedraw();"), "touch admission must cancel queued interaction redraws");
	assert(!mainSource.includes("this.currentStroke.points = this.currentStroke.points.slice(0, this.currentStrokeRenderedPointCount)"), "preview lag must never truncate recorded touch samples");
	assert(mainSource.includes("private nextPageZIndexCache = new Map<number, number>();"), "rapid strokes must use a constant-time page z-index allocator");
	assert(!mainSource.includes("const liveStrokeIds = new Set(this.annotationDocument.strokes.map"), "stroke commit must not scan every stored stroke");
	assert(!mainSource.includes("maskedStrokeRasterCache"), "touch erase must not retain or rerender masked source strokes");
	assert(!mainSource.includes("applyStrokeEraseMasks"), "page rendering must not replay touch eraser paths");
	assert(mainSource.includes("private isFingerPanRenderingPaused(): boolean"), "finger-pan rendering state must be explicit and testable");
	assert(mainSource.includes("private isViewportMotionActive(): boolean"), "scrollbar, trackpad, and finger-pan rendering state must share one guard");
	const pageRenderJobSource = mainSource.slice(
		mainSource.indexOf("private startPageRenderJob"),
		mainSource.indexOf("private schedulePageRenderJobs")
	);
	assert(pageRenderJobSource.includes("this.isViewportMotionActive()"), "committed page rendering must not start during scrolling, finger pan, or inertia");
	assert(pageRenderJobSource.includes("this.pendingRedrawPages.add(pageNumber);"), "pages skipped during viewport motion must remain queued for refresh");
	const fingerPanDownSource = mainSource.slice(
		mainSource.indexOf("private handleFingerPanPointerDown"),
		mainSource.indexOf("private readonly handleFingerPanPointerMove")
	);
	assert(fingerPanDownSource.includes("this.pauseCommittedRenderingForViewportMotion();"), "finger pan must cancel in-flight committed rendering before scrolling");
	const fingerPanInertiaSource = mainSource.slice(
		mainSource.indexOf("private startFingerPanInertia"),
		mainSource.indexOf("private cancelFingerPanInertia")
	);
	assert(fingerPanInertiaSource.includes("this.resumeCommittedRenderingAfterFingerPan();"), "annotation rendering must resume when finger-pan inertia settles");
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			skipLibCheck: true
		}
	});
	const moduleShim = { exports: {} };
	vm.runInNewContext(transpiled.outputText, {
		module: moduleShim,
		exports: moduleShim.exports
	}, { filename: "cooperativeRender.check.cjs" });
	const { prioritizeRenderPages, runCooperativeRenderSlice } = moduleShim.exports;

	assert(typeof prioritizeRenderPages === "function", "visible page rendering has no current-page priority policy");
	const prioritizedPages = prioritizeRenderPages([4, 2, 3, 1], 3, null);
	assert(prioritizedPages.join(",") === "3,2,4,1", `current-page strokes were not prioritized (${prioritizedPages.join(",")})`);
	const pointerPrioritizedPages = prioritizeRenderPages([4, 2, 3, 1], 3, 4);
	assert(pointerPrioritizedPages.join(",") === "4,3,2,1", `active pointer page was not prioritized (${pointerPrioritizedPages.join(",")})`);

	const pauseInkSource = mainSource.slice(
		mainSource.indexOf("private pauseCommittedRenderingForInkInput"),
		mainSource.indexOf("private isFingerPanRenderingPaused")
	);
	assert(pauseInkSource.includes("this.queueInterruptedPageRenders();"), "Pencil/touch input drops unfinished existing-stroke render jobs");
	const resumeInkSource = mainSource.slice(
		mainSource.indexOf("private resumeCommittedRenderingAfterInkInput"),
		mainSource.indexOf("private isFingerPanRenderingPaused")
	);
	assert(resumeInkSource.includes("this.flushDeferredScrollRedraws();"), "existing-stroke rendering does not resume as soon as ink input ends");
	assert(mainSource.includes("prioritizeRenderPages(Array.from(this.pageRenderJobs.keys())"), "the active page-render queue does not apply current-page priority");

	let inputPending = true;
	let executed = 0;
	const blockedResult = runCooperativeRenderSlice(
		[{ run: () => { executed += 1; }, expensive: true }],
		0,
		{ budgetMs: 4, now: () => performance.now(), isInputPending: () => inputPending }
	);
	assert(blockedResult.nextStep === 0 && executed === 0, "pending input must prevent old-stroke rendering from starting");

	inputPending = false;
	const expensiveSteps = Array.from({ length: 4 }, () => ({
		run: () => {
			executed += 1;
			busyWait(6);
		},
		expensive: true
	}));
	const firstSlice = runCooperativeRenderSlice(
		expensiveSteps,
		0,
		{ budgetMs: 4, now: () => performance.now(), isInputPending: () => false }
	);
	assert(firstSlice.nextStep === 1, `one render task processed ${firstSlice.nextStep} expensive strokes instead of yielding after one`);

	let simulatedClock = 0;
	let shortStrokeCount = 0;
	const shortStrokeSteps = Array.from({ length: 12 }, () => ({
		run: () => {
			shortStrokeCount += 1;
			simulatedClock += 0.75;
		},
		expensive: true
	}));
	const shortStrokeSlice = runCooperativeRenderSlice(
		shortStrokeSteps,
		0,
		{ budgetMs: 4, now: () => simulatedClock, isInputPending: () => false }
	);
	assert(shortStrokeSlice.nextStep >= 4, `render budget was wasted after only ${shortStrokeSlice.nextStep} short existing stroke(s)`);

	let nextStep = 0;
	let inputHandledAfterStep = -1;
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("cooperative render test timed out")), 1000);
		const scheduleSlice = () => {
			setTimeout(() => {
				const result = runCooperativeRenderSlice(
					expensiveSteps,
					nextStep,
					{ budgetMs: 4, now: () => performance.now(), isInputPending: () => false }
				);
				nextStep = result.nextStep;
				if (nextStep >= expensiveSteps.length) {
					clearTimeout(timeout);
					resolve();
					return;
				}
				scheduleSlice();
			}, 0);
		};
		scheduleSlice();
		setTimeout(() => {
			inputHandledAfterStep = nextStep;
		}, 0);
	});

	assert(inputHandledAfterStep >= 1, "input callback did not run after rendering began");
	assert(inputHandledAfterStep < expensiveSteps.length, "input callback waited for the entire previous-page render");
	console.log(`Render concurrency verifier passed. input handled after ${inputHandledAfterStep}/${expensiveSteps.length} expensive strokes.`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
