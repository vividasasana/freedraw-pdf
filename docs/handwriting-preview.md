# Handwriting development history

## Current device status

The user requested the continuous engine and retained-SVG zoom handling together after the temporary rollback, then authorized regular publication through the Vida Sana account. Version 0.13.7 is a regular release, and 0.13.7 sets Smoothest/Linear/debugging-off defaults and hides engine diagnostics unless enabled. Earlier iPad feedback reported severe lag, crashes, disappearing PDFs, and lost zoom alignment; these device-level failures have not been established as resolved. Automated checks cover continuous geometry and retained zoom separately.

Handwriting changes prepared for release 0.13.7, developed through local previews based on 0.13.5.

The 2026-10-07 SVG preview includes the pressure-response, direction-reversal, and vector-display updates below.

The latest round-smoothing revision restores full pressure peaks. Smoothing now changes corner geometry and neighbouring widths, rather than reducing the strongest point's width.

## Changes

- New strokes record a continuous-v1 ink pipeline: nib-bounded spatial denoising, continuous cubic direction tangents, monotone pressure interpolation, and error-bounded curve subdivision. Timestamp/velocity data do not determine pressure width. Recorded endpoints and pressure peaks are retained, with identical full-quality live and committed geometry and no synthetic tail. Compact tangent tubes reduce path pieces versus expanded polygon/disk coverage. SVG arc direction is normalized to match Canvas long arcs. Older stroke pipelines remain recorded and unchanged.
- Saving fixes use the exact selected stable SVG-zoom baseline. Later scrolling and edge-version experiments are preserved separately outside the vault.
- Sidecar comparison ignores formatting, object-key order and the root save timestamp while comparing all annotation content. Independent stroke additions merge conservatively; changes to existing strokes or other annotation types remain conflict-protected. Remote additions refresh the retained vector frame and become part of the saved document.
- Keep vector overlays at the host page's full relative size during pinch zoom; prefer layout dimensions over transformed bounding boxes. Vector frame identity is independent of zoom and unchanged committed frames bypass geometry rebuilding. Actual edits still invalidate frames, and raster fallback frames remain size-dependent.
- Replace perpendicular connections between changing-width round sections with external tangents, avoiding a sharp join at their circular boundaries. Increase curve subdivisions for sparse bends. The new edge version is recorded with new strokes; previously saved strokes retain their geometry.
- Stylus identity now overrides Drawing speed pressure input: pen, explicitly marked stylus, and bridged Apple Pencil samples always use actual pressure or retain the last pressure when unavailable. Speed simulation is restricted to non-stylus input. Existing saved pressure samples are unchanged.
- Zero-pressure stylus samples retain the previous real pressure instead of falling through to velocity simulation. A release endpoint inherits the last contact pressure; coalesced movement samples retain actual pressure. This addresses a code path that could widen short strokes at lift-off. Device confirmation remains pending.
- Stroke preview now offers Fast (fewer live curve subdivisions), Accurate (saved geometry with no tip prediction), and Auto smooth (small adaptive tip prediction, reduced at bends, speed changes, gaps, or pressure changes). All modes retain Pencil pressure and use full geometry when the stroke finishes. Older Smooth/Quality settings migrate to Auto smooth; Balanced migrates to Accurate. Preview modes do not change saved width settings.
- Add Original / Extra smooth width smoothing modes. The revised Extra smooth mode follows actual pressure with a small causal blend over distance/time and interpolates bend widths without forcing a midpoint peak. It removes the first revision's global peak lift and broad width envelope, which made light-pressure sections too wide. Original retains peak-preserving behaviour. A per-stroke version preserves previously saved geometry.
- Preserve the original Pencil down point and accumulate small movements from a fixed anchor. A replay of 240 dense samples previously collapsed a curved path into two endpoints.
- Accept stylus samples in time order, reject stale samples, and retain the final coalesced curve when the Pencil lifts.
- Draw the same pressure-sensitive numeric outline without formatting an unused SVG path on every canvas preview frame. SVG consumers retain their existing return value.
- Limit each mobile annotation canvas to four million pixels (at most 16 MiB of raw RGBA pixels) and a 4096-pixel side. All canvas transforms use the capped ratio; CSS page dimensions and stored coordinates retain their original values.
- Release overlay buffers for pages outside the viewport. Keep snapshot buffers alive until their asynchronous copy finishes, queue rendering when all three slots are busy, and reuse one bounded offscreen scratch canvas for interrupted object erasing.
- Group annotations once during layer normalization. The 10,000-stroke/100-page fixture drops from 1,010,000 page reads to 10,000 without changing layer order.
- Expose pressure sensitivity, stabilization, stroke smoothing, and the pressure curve in the Handwriting settings section. These existing controls apply to new strokes.
- Stroke smoothing now amplifies Pencil pressure changes in both directions for new strokes. Higher values widen firm strokes and narrow light strokes more strongly, with neutral width preserved. Stabilization continues to control the path.
- Preserve detailed contour points around direction reversals so high smoothing cannot introduce the reproduced internal gap and separate rounded head. New strokes record a pressure-response mode; earlier strokes keep their saved edge-rounding geometry.
- Render both live and committed annotations as SVG paths at the current zoom, using the same pressure-outline drawing commands. Keep the input canvas transparent and reuse unchanged SVG paths, rather than enlarging a capped bitmap for the final display.
- Limit temporary eraser masks to the viewport and release SVG paint trees for cold pages. Export page and region snapshots directly from annotation data at the output resolution, including inserted paper pages.
- New strokes use a gentler pressure response with a soft limit on width variation and smaller pressure jumps. Higher smoothing still strengthens the response, with reduced bulging during extreme or light contact pressure. The per-stroke tuning marker preserves older ink through save/load and export.
- The latest revision replaces that gentle-pressure behaviour for new strokes with connected rounded geometry: one nonzero fill joins round sections without internally capped heads at direction changes. Increasing smoothing rounds the centerline and extends peak widths into nearby samples without averaging the peak down. Raw Pencil pressure peaks are retained during capture.
- Pressure sensitivity ranges from 0 to 1: harder pressure makes new strokes wider. Existing negative settings migrate to their positive magnitude. Old stored stroke geometry remains associated with its original renderer.

## Validation

The 0.13.7 production build, complete repository verifier suite, and deployment privacy checks passed. Coverage includes the revised Extra smooth mode, adaptive preview modes, pressure-only stylus capture, settings migration, and compiled-plugin startup. Device feedback is still needed for Apple Pencil latency and iPad zoom stability.

Run `node scripts/check-round-smoothing.js` for actual corner rounding, peak preservation, neighbouring widths, reversal coverage, and zoom/reopen parity. The handwriting, pressure-response, vector-display, and stroke-settings checks cover earlier renderer compatibility, display, erasing, publication, snapshots, sidecar persistence, and export. Run `node scripts/run-checks.js` for the complete repository verifier suite after building with `node esbuild.config.mjs production`.

The browser edge-quality comparison confirms crisp SVG outlines at the extreme zoom where the previous capped-canvas display was visibly blurred. Automated replays use synthetic input and DOM/canvas doubles; they do not measure real Apple Pencil latency or establish that iPadOS/PDF.js itself cannot crash. The canvas cap remains for raster fallbacks, rather than determining final SVG edge resolution. Previously recorded straight joins cannot recover missing points.

## Install the local preview

Disable Freedraw PDF in Obsidian, extract the preview archive, and replace `main.js`, `manifest.json`, and `styles.css` in the vault's configuration folder under `plugins/freedraw-pdf`. Re-enable the plugin and let the plugin files sync to the iPad. Existing settings and annotation sidecars are separate files.

On the iPad mini 6, check slow curves, rapid dots and short strokes, long continuous writing, pressure variation, repeated zooming, and reopening a heavily annotated document. Check that a finger still pans while the Pencil draws. The Goodnotes comparison remains a device-level quality target, not a verified match.
