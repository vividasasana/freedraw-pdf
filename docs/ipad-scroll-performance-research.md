# Dense annotation scrolling on iPad

Research date: 12 October 2026. Scope: the current retained SVG renderer, PDF viewport motion, and WebKit rendering. This note does not establish an iPad performance result.

## What the sources establish

- **Geometry caching and painting are separate costs.** WebKit draws elements into layers and then composites those layers. A layer can avoid repainting, but additional layers consume memory; WebKit explicitly cautions against excessive layers on constrained devices. Measure paint counts and layer memory before forcing GPU promotion. [WebKit Layers documentation](https://webkit.org/web-inspector/layers-tab/)
- **Group opacity preserves appearance through isolated composition.** SVG describes group opacity as painting the group into an intermediate RGBA image, then blending the result. Giving every child its own opacity changes the overlap result. This is a rendering model, not proof that WebKit allocates one full bitmap per stroke in every case. [SVG rendering specification](https://www.w3.org/TR/SVG2/render.html#ObjectAndGroupOpacityProperties)
- **`display: none` and detaching eliminate an SVG subtree from rendering; `visibility: hidden` leaves it in the rendering tree.** Hiding only the committed vector body can reduce painting while retaining a separate input surface. [SVG visibility specification](https://www.w3.org/TR/SVG2/render.html#VisibilityControl)
- **Render visible work first and bound retained page resources.** PDF.js prioritizes visible pages, zoomed partial views, then the adjacent page in the scrolling direction; its viewer uses a bounded page buffer. Its implementation is a useful model, not an Obsidian API promise. [PDF.js render queue](https://github.com/mozilla/pdf.js/blob/master/web/pdf_rendering_queue.js), [viewer buffer](https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js)
- **Profile the actual paint pipeline.** Safari Web Inspector separates JavaScript, style/layout, paint/composite and memory. Its frame view makes expensive frames visible; JavaScript replay measurements alone cannot establish smooth scrolling. [WebKit Timelines documentation](https://webkit.org/web-inspector/timelines-tab/)

## Local code observations

Observed before implementation changes in this task:

- `SvgDrawingContext.drawLiveContinuousStroke` retains groups of short path sections and fits only a recent tail. Those groups use opacity 0.96 for pen or 0.24 for highlighter; committed promotion retains their structure. This reduces fitting work but retains vector paint complexity.
- `SvgAnnotationRenderer.publish` reuses unchanged DOM nodes and an SVG `viewBox` preserves immediate zoom scaling. This is valuable and should remain the exact, idle representation.
- `handleScroll` pauses page render jobs and waits 160 ms before its idle refresh. `pauseCommittedRenderingForViewportMotion` queues hot pages again, so unchanged pages may still traverse redraw/publication after motion.
- `updateVisiblePageRange` runs at idle. Cold pages release SVG state and canvas stores through `releasePageCanvasResources`; `PAGE_VIRTUALIZATION_MARGIN` is already zero. The immediate issue is not an unlimited margin setting.
- The annotation backing-store budget already caps mobile surfaces at four million pixels and a 4096-pixel side. Three render-slot canvases can coexist with committed/transient surfaces, so any new raster preview needs a shared byte budget and explicit disposal.

## Recommended practical change

**First remove avoidable redraws after pure scrolling. Then test a bounded raster display cache for dense pages during motion.**

1. Use the existing document/page revision and published-frame key to skip unchanged committed frames after a scroll. No point scan, SVG publication, or path fitting should occur solely because the page moved.
2. Prepare a page raster preview after a valid committed frame, while idle. During motion, display that already-built image and set only the committed SVG body to `display: none`. Keep the live layer and pointer/input overlay intact. Never synchronously serialize or rasterize thousands of paths on the first scroll event.
3. Restore retained SVG after idle, without rebuilding geometry. The preview is a temporary display cache; SVG and saved annotation coordinates remain authoritative. Zoom should immediately CSS-scale the preview, then return to sharp SVG when stationary.
4. Invalidate previews on ink, erasure, text/shape/image edits, reordering, recovery and document replacement. Cancel stale asynchronous snapshot results with revision tokens. On failed conversion, retain SVG instead of blanking the annotation layer.
5. Bound preview memory across pages and release canvas pixels, images and object URLs on page eviction/unload. If dense pages remain costly while stationary, consider spatial tiles or a small visible-page cache; avoid per-stroke compositor promotion.

The raster approach is a **hypothesis** that moves repeated vector painting into one cached image during motion. It must preserve highlighter opacity, erase masks, embedded images, text, stacking and quick-add page backgrounds. It must not change annotation JSON, pressure or SVG geometry. A blanket `content-visibility: auto` change is not a reliable substitute: a current WebKit issue reports repeated re-entry scroll jank, although that report does not prove this plugin is affected. [WebKit issue 318216](https://bugs.webkit.org/show_bug.cgi?id=318216)

## Validation limits and measurements

Use identical synthetic pages at 100, 1000 and 3000 strokes, including long strokes, highlights, text and images. Compare first scroll, repeated re-entry, pinch zoom, and drawing immediately after scrolling. Record frame durations, paint/composite counts, JS redraw counts, SVG node/path-command counts and retained raster bytes. Confirm exact idle appearance and immediate Pencil input; test save/reopen separately.

Automated Chromium and CPU checks can verify cache invalidation and unchanged-frame behavior. They cannot certify iPad WebKit frame timing, texture-memory pressure, native scrolling, theme interaction or Apple Pencil capture. A physical iPad trace remains required before describing the lag as resolved.

## User-linked iPad fork

Reviewed [dhairyapatel915/freedraw-pdf-ipad](https://github.com/dhairyapatel915/freedraw-pdf-ipad) at commit [`4ae586d`](https://github.com/dhairyapatel915/freedraw-pdf-ipad/commit/4ae586d487c71a925d0c1e694fe130f94d32eb7f), a single change on upstream 0.13.5.

- Adds an explicit multi-touch navigation state, finishes stale input before pinch, pauses committed rendering during pinch, and resumes after all fingers leave. This is a relevant gesture-handoff idea for targeted adoption and iPad testing.
- Removes time-based resampling and centreline subdivision from the older ink engine, changes default thinning to 0.15, and makes pen paint opaque. These are different trade-offs from the current continuous-v1 engine, which already bypasses that older resampling path. Copying them wholesale would change pressure/appearance and would not retain the newer SVG/save/file-management pipeline.
- It does not add dense-page tiling, raster motion previews or page-specific frame validity. The diff alone does not demonstrate a solution for scrolling pages with many strokes.

## Changes and scan pass in this investigation

A deterministic replay showed that appending ink erased other pages' frame records and changed their cache keys. The local fix scopes ink-append invalidation to its page, preserves other pages' frame keys, and stamps an appended page current only when its previous SVG frame was complete. General edits continue to invalidate frames. Full functional checks are recorded separately; the physical iPad outcome remains unverified.

A targeted lint pass uses official eslint-plugin-obsidianmd 0.4.2 and TypeScript ESLint with current Obsidian API definitions. It checks all main/src TypeScript files for the original promise callback, globalThis, manual settings-heading and missing settings-definition findings. The pass produced zero findings over 44 files. This is not the entire remote scorecard: runtime base64 disclosure and unavailable malware/obfuscation scans are outside those rules, and the website still evaluates its published release.

## Cached scrolling implementation — 13 October 2026

Dense pages (80 or more rendered annotations) can prepare a preview after 1.2 seconds idle, with no active pointer/text editing or save operation. The cache holds at most two pages and 12 MiB of estimated decoded/encoded memory. Each raster is bounded to 512 Ki pixels and a 1024-pixel side. Oversized SVG trees, conversion failures and images still loading keep the SVG visible.

During motion, a ready transparent PNG replaces only the committed SVG body. The live layer and pointer overlay remain separate, and SVG restores at idle or before any tool admits input. Preview images scale in the existing SVG viewBox. Editing, promotion, erasure, document replacement and page eviction invalidate snapshots and revoke object URLs. In-flight stale results are rejected. No previews are written to annotation JSON or synced.

Synthetic native-browser validation passed SVG-to-PNG conversion, highlighter group opacity (61/255 in both overlap regions), cache activation and restoration to the original SVG. Cache/renderer tests cover readiness, stale conversions, input and edit invalidation, failure fallback, layer order and disposal. The complete functional suite and targeted Obsidian lint pass also passed. Actual iPad scrolling latency and memory behaviour still require device validation.

A new cold-page regression also caught a skipped cleanup case: SVG pages with 1×1 canvas buffers and no render slots did not enter the release branch. The predicate now includes committed SVG frames, so offscreen vector bodies and their preview URLs are released even when no large canvas exists.

An observer regression found that removing owned SVG paths or preview images could be classified as a native PDF DOM change. The observer now checks the mutation target first and retained SVG layer markers identify detached groups. Native PDF page replacements still trigger layout synchronization; annotation-only changes do not.
