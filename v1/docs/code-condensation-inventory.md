# v1 code condensation inventory

_Scanned 2026-08-23. Scope: `main.ts` and every TypeScript file under `src/`._

## Baseline

- Runtime TypeScript files: 34 before the first extraction.
- Runtime TypeScript lines: approximately 20,054 before cleanup.
- `NativePdfAnnotatorSession`: approximately 12,555 lines, 506 methods, 164 properties, and 676 total members.
- `PDFAnnotatorPlugin.onload`: 561 lines before command registration was condensed.
- Original root project: left unchanged. All work in this document applies only to `v1/`.

The dominant maintenance problem is not the number of small files. It is that input, page lifecycle, rendering, tools, mixed pages, text, images, selection, menus, export, persistence, and diagnostics all reach into one session implementation.

## Existing reusable modules

| Module | Responsibility | Decision |
| --- | --- | --- |
| `src/ink/inkEngine.ts` | Perfect Freehand configuration, sample conditioning, outline generation, and Canvas paths | Keep and deepen. Live and committed ink must continue through this one geometry path. |
| `src/pointer/pointerInput.ts` | Stylus detection, finger policy, coalesced samples, and pressure normalization | Keep. Evolve into the pure policy half of `InputArbiter`; do not delegate WebKit ownership to a general gesture package. |
| `src/annotation/{bounds,geometry,interaction,eraser,renderOrder}.ts` | Pure annotation geometry and ordering | Keep. These are already strong in-process modules. Consolidate duplicated broad-phase scans behind `SpatialIndex`; retain these exact tests as the narrow phase. |
| `src/stores/annotationStore.ts` | Sidecar lookup, normalization, migration, save, and deletion | Keep. Place document mutations/history in front of it rather than expanding its interface. |
| `src/tools/toolState.ts` | Tool presets and active tool state | Keep. Tool interactions should consume it instead of copying tool state into session fields. |
| `src/text/textLayout.ts` | Text wrapping, alignment, sizing, and stable frame geometry | Keep. Move text DOM orchestration out of the session while retaining this pure layout implementation. |
| `src/pdf/{pdfDom,nativePdfJs,zoomAnchor}.ts` | Host viewer lookup and zoom anchor calculations | Keep and combine behind a deeper `PageSpace`/`PdfSurface` interface. Do not bundle a second PDF.js. |
| `src/render/cooperativeRender.ts` | Time-budgeted background rendering | Keep. It protects input latency. |
| `src/ui/popoverPlacement.ts` | Viewport-safe anchored placement | Keep. Add lifecycle/exclusivity to a separate popover registry, not to the geometry function. |
| `src/interaction/cursorState.ts` | Stable selection cursor transitions | Keep and fold into `InputArbiter` effects when pointer migration begins. |
| `src/notebook/*` | Mixed-page model, lifecycle, templates, and template rendering | Keep as a feature module, but remove its branches from the core session. |
| `src/markdown/*` | Annotated embed controller and rendering | Keep as a feature module. Its Obsidian adapter is a real seam. |
| `src/export/*` | Mixed-document export and minimal PDF writing | Keep behind one export interface. |
| `src/settings/*` | Persisted settings and settings UI | Keep. The duplicated unreachable settings implementation was removed in `v1`. |
| `src/debug/renderTelemetry.ts` | Optional render/input telemetry | Keep isolated and disabled by default; it must not become part of the input hot path. |

## Repeated clusters found in `main.ts`

| Cluster | Evidence | Condensation seam |
| --- | --- | --- |
| Active-session commands | Dozens of identical resolve/check/run wrappers | `registerSessionCommands`; implemented in the first pass. |
| Pointer lifecycle | Pointer down/up are 237/265 lines and branch across every tool | `InputArbiter` plus `ToolInteraction`. |
| Popovers and menus | Eight element fields, repeated backdrop/key listener cleanup, and many repeated `Menu.addItem` chains | `PopoverRegistry` and declarative menu descriptors. |
| Page coordinates | Client/page conversion, scale, bounds, zoom anchors, selection, text, and image placement occur in different methods | `PageSpace`. |
| Annotation mutation | Mutate/history/save/invalidate/redraw sequences are distributed across tools | `AnnotationHistory` executing semantic commands. |
| Mixed-page workflow | Navigation, thumbnails, page menus, lifecycle, templates, and exports span the session | `MixedPageFeature`. |
| Text workflow | Editor DOM, formatting menus, selection mutations, layout, and rendering span the session | `TextFeature`, retaining `textLayout` as an internal module. |
| Rendering lifecycle | Page job scheduling, offscreen publication, committed pixels, and invalidation share state with input | `AnnotationRenderer`, coordinated through returned affected-page results. |

## Target interfaces

```ts
interface InputArbiter {
	handle(event: NativeInputEvent): readonly InputEffect[];
	cancel(reason: CancelReason): readonly InputEffect[];
}

interface PageSpace {
	fromClient(page: number, point: ClientPoint): PagePoint;
	toClient(page: number, point: PagePoint): ClientPoint;
	transformBounds(page: number, bounds: PageBounds): ClientBounds;
	captureZoomAnchor(input: ZoomInput): ZoomAnchor;
	restoreZoomAnchor(anchor: ZoomAnchor): void;
}

interface AnnotationHistory {
	execute(command: AnnotationCommand): DocumentResult;
	undo(): DocumentResult;
	redo(): DocumentResult;
}

interface ToolInteraction {
	begin(input: ToolInput): readonly ToolEffect[];
	update(input: ToolInput): readonly ToolEffect[];
	finish(input: ToolInput): readonly ToolEffect[];
	cancel(): readonly ToolEffect[];
}
```

`DocumentResult` should include changed annotations and `affectedPages`. Persistence, spatial-index updates, and redraw scheduling consume that result instead of each mutation remembering all three side effects.

## Dependency decisions

- Retain `perfect-freehand` behind `inkEngine`.
- Use Obsidian's host-provided command/menu interfaces through local registries.
- Adapt PointerTracker's pointer-ledger idea, but do not add the archived package.
- Adapt Immer's command/inverse-patch model, but do not add Immer before all mutations cross one seam.
- Consider `rbush` behind a page-scoped `SpatialIndex` only after a linear-versus-index benchmark and equivalence test demonstrate value.
- Do not add `@use-gesture/vanilla`, Signature Pad, Flatbush, Konva, or another PDF.js bundle.

See [`reusable-modules-research.md`](reusable-modules-research.md) for primary-source citations and detailed tradeoffs.

## First pass completed in v1

- Created `src/commands/sessionCommands.ts` and migrated active-session command boilerplate to it.
- Removed the unreachable legacy settings implementation.
- Narrowed TypeScript compilation to `main.ts` and `src/**/*.ts`.
- Corrected the overlay cursor-tool type to include the real `"disabled"` state.
- Added a behavioural verifier for the command registry.

After this pass, `main.ts` is 13,556 lines and `settingTab.ts` is 511 lines. Runtime TypeScript is reduced by roughly 600 net lines without removing a command or feature.

## Next migration order

### Second pass completed

- Added `src/ui/transientPopoverRegistry.ts` as the single lifecycle owner for all eight custom popovers.
- The registry guarantees exclusive replacement, backdrop dismissal, Escape dismissal, close callbacks, and idempotent disposal.
- The DOM adapter captures the PDF view's owning `Document` and `Window`, so the lifecycle remains correct in Obsidian popout windows.
- Removed the session's eight popover element fields, backdrop field, repeated Escape listeners, duplicate pointer propagation handlers, and repeated cleanup bookkeeping.
- Preserved page-list body state and text-editor refocusing through explicit close callbacks.
- Added a behavioural registry verifier and strengthened toolbar/text checks around the new interface.

After this pass, `main.ts` is 13,412 lines. The registry adds 104 reusable lines while removing 144 lines from the central session; total runtime source is approximately 19,402 lines, about 652 fewer than the copied baseline.

### Third pass completed

- Added `src/ui/menuDescriptors.ts` and migrated the repeated tool, selection, region, template, page-size, and paper-color native menus to one declarative renderer.
- Added shared notebook template and page-size option constants instead of recreating the same arrays in each menu.
- Ran TypeScript with `noUnusedLocals` and `noUnusedParameters`, then removed 27 compiler-proven unused private methods and obsolete pass-through parameters.
- Removed the empty mixed-export host adapter; the export seam now receives only the state it uses.
- Added a menu-descriptor behavioural verifier and updated stale source-contract checks to the currently visible menu labels.
- Added `scripts/create-test-vault.js`. Packaging now synchronizes release assets into the registered `v1/obsidian` test vault, verifies the sample PDF and installed bundle, and creates the release ZIP in one command.

After this pass, `main.ts` is 12,143 lines and the 37 runtime TypeScript files total 17,709 lines. That is roughly 2,345 fewer runtime lines than the copied baseline while retaining the tested feature paths.

### Remaining migration order

1. `PageSpace`, migrating text/image/selection before input.
2. `AnnotationHistory` with semantic commands and affected-page results.
3. `InputArbiter`, preserving current Pencil/touch tests before changing pointer ownership.
4. `ToolInteraction`, one tool at a time.
5. `MixedPageFeature`, `TextFeature`, `EmbedFeature`, and `ExportFeature`.
6. Thin the session to lifecycle coordination and delete superseded paths/tests rather than layering replacements.
