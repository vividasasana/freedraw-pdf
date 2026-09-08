# V2 interaction improvements — 0.13.2

V2 is a separate copy of v1. The v1 plugin implementation is preserved; deployment tooling was hardened during the release privacy review. This build keeps the `freedraw-pdf` plugin ID and annotation format for compatibility.

## Try the build

Open `v2/obsidian` as a separate Obsidian vault, enable Freedraw PDF, and open `Test PDF.pdf`. The local vault contains the built plugin and keeps test annotations when regenerated. The installable archive is `v2/dist/freedraw-pdf-0.13.2.zip`.

For another test vault, install the ZIP's `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/freedraw-pdf`. This replaces the enabled build in that vault; v1 and v2 share a plugin ID. Use copies of existing PDFs and sidecars for comparison.

The toolbar is horizontal; the vertical option has been removed. Annotation-mode shortcuts are **1 Pen · 2 Highlighter · 3 Eraser · 4 Select · 5 Text**. Editors, popovers, modifier shortcuts, composition, and read mode keep their normal keyboard behavior.

## Changes against your feedback

| Concern | Implemented change |
| --- | --- |
| Pen delay and smoothing | The Stabilization setting controls temporal filtering, centerline smoothing and streamline. 0 disables path stabilization; higher values smooth more strongly. The default is 0.12 (12 ms window). Settings changes apply only to new strokes. Each stroke stores its rendering settings; existing ink keeps its appearance through zoom, reopen, undo, erasing and export. Coalesced samples and pressure filtering remain. |
| Stroke changes on release | Balanced and Accurate previews use the same geometry as committed ink. Pen-up samples retain the previous pressure when the device reports zero. Stroke outlines are calculated at a fixed reference scale so zoom does not change their shape. |
| Scroll, zoom, page lag | Finished page frames are reused when unchanged; page publication uses canvas compositing without synchronous full-page pixel readback. Cooperative rendering and the existing zoom anchor are retained. |
| Finger and palm input | New settings default to finger panning. A small contact with pressure alone is no longer sufficient to classify a finger as a stylus; explicit pen, tilt, and WebKit stylus identification remain supported. |
| Moving and resizing | During selection transforms, the stationary annotations are cached; frames redraw the moving selection and handles. |
| Erasing | Segment cuts use smooth round heads and tails, with tapering suppressed at cut ends. Original endpoints remain rounded. |
| Text editing | The native textarea paints text and its caret, supports normal arrow navigation and composition, and avoids full annotation-page redraws on each keystroke. |
| Tool changes | Added guarded number shortcuts and preserved toolbar scroll position during refresh. |
| Toolbar | Horizontal inline/floating layouts and keyboard focus outlines. The vertical option has been removed. |
| Temporary page placement | Temporary pages are physically interleaved after their PDF anchor, including repeated additions. Quick-add and insertion dialogs retain the page where the menu was opened. |
| New PDFs | Default to white blank pages. The PDF itself stays white; colour and template live in editable sidecar overlays. Use **Page → Template** and **Page → Paper** just as on temporary pages. |
| Save reliability | Saves serialize and drain new edits received during a write. PDF switches flush the previous document first. Conflicting views cannot silently overwrite each other; failed saves attempt a separate recovery sidecar. |

Existing user settings are retained. Older sidecars without per-stroke settings use a fixed baseline captured from the preferences at this upgrade. That baseline is retained across restarts and future setting changes, including for notes not yet reopened. Historical appearances already changed by an earlier build cannot be reconstructed. When comparing responsiveness with v1, use **Balanced** preview and **0.12 streamline** in v2; an existing saved streamline value is not automatically replaced.

Invalid annotation JSON or document structure blocks editing instead of opening a writable empty layer. File-size-only orphan recovery is disabled. Renaming or deleting a PDF preserves the previous sidecar. Undo snapshots inherit their view's latest save baseline. Indexed sidecars use Obsidian's `Vault.process` to check for intervening changes during updates. Export retains original PDF page dimensions and releases raster canvases after use.

If a conflict notice provides a `.recovery-….annot.json` path, keep that file alongside the primary sidecar; both versions remain available for manual reconciliation. There is no automatic multi-view merge. Recovery still depends on writable storage, and simultaneous external sync writes cannot be completely controlled by this plugin.

## Release safety improvements

Image annotations accept embedded image data only, preventing network requests from URLs planted in a sidecar. Test deployment copies only the three plugin assets to an explicitly selected or local test vault; it no longer uploads the whole vault to OneDrive. Malformed plugin-list configuration is preserved and reported instead of reset. Packaging does not modify a test vault.

## Validation and remaining device checks

- `npm run check`: 21 check groups, including TypeScript/module integrity, ink, eraser, pointer routing, render concurrency, text, toolbar, zoom, save conflicts, delayed writes, file switching, recovery, and PDF dimensions.
- A selection replay verifies 1,000 stationary strokes render once across 21 drag frames.
- `npm run build`: production bundle.
- `output/playwright/smoke.cjs`: local browser harness using the real session and toolbar with Obsidian host services stubbed. Exercises tool clicks, 1–5 shortcuts, text entry, native caret navigation, read-mode guarding, horizontal layout, repeated temporary-page placement, and editable colour/template overlays. It does not run Obsidian's PDF.js host or emulate physical stylus latency. Screenshots use placeholder host icons.

The browser checks use a simulated PDF page DOM, not the running Obsidian PDF.js viewer. Physical pen latency, palm rejection, pinch zoom, long-PDF behavior, pop-out windows, and the final text/ink appearance still need a device pass in Obsidian. GitHub issue #2 is not marked resolved by this work. The optional Smooth preview retains a small amount of prediction and can differ at release. Segment erasing still rebuilds the affected fragments, and selected objects appear above stationary objects during a drag before their normal order is restored. Exports remain flattened raster PDFs.

Use the test PDF to compare quick loops, slow diagonals, dots, pen-up shape, repeated pinch/scroll, moving a dense selection, partial erasing, and reopening after edits. The improvements are implemented and checked; equivalence to Goodnotes has not been established.
