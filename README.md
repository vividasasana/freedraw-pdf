# Freedraw PDF — v2 / 0.13.2

Freehand PDF annotation for Obsidian: handwriting, highlighting, text, images, temporary notebook pages, and flattened PDF export. Requires Obsidian 1.12.0 or later.

| Folder | Version | Role |
| --- | --- | --- |
| [v0](v0/) | 0.12.9 working copy | Original root implementation, including local improvements present before this reorganization. |
| [v1](v1/) | 0.12.10 | Previous published implementation. |
| [v2](v2/) | 0.13.2 | Maintained plugin; all current builds and releases use this folder. |

The folders share the same plugin ID, `freedraw-pdf`. Install one version per vault. The root `manifest.json` and `versions.json` mirror v2 for Obsidian update discovery; root npm commands delegate to v2. The archived plugin implementations are preserved; their test deployment scripts received the same privacy fix.

## What changed

- Adjustable stroke stabilization and stable pen-up rendering. Changing settings affects new strokes only; existing strokes retain their rendering settings.
- Rounded ends on partially erased strokes; lower-cost page redraws and selection dragging.
- Normal text caret navigation and guarded annotation shortcuts: **1 Pen, 2 Highlighter, 3 Eraser, 4 Select, 5 Text**.
- A horizontal toolbar, with the vertical option removed.
- Temporary pages inserted at the selected PDF page, including repeated quick additions.
- New PDFs use blank white source pages; paper colour and template remain editable through the page menu.
- Serialized saves, conflict detection, and recovery sidecars for failed saves.
- Embedded image data only, and plugin-only test deployment without automatic whole-vault cloud copying.

See [release notes](docs/releases/0.13.2.md), [detailed v2 changes](v2/V2-CHANGES.md), and the [safety and privacy review](docs/security-review-0.13.2.md).

## Install

Download the ZIP or the three files from [GitHub Releases](https://github.com/vividasasana/freedraw-pdf/releases). Put `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/freedraw-pdf` in your vault, reload Obsidian, and enable Freedraw PDF. Source folders are not installable packages.

## Develop

Use Node.js 24 and npm:

```sh
npm ci
npm run check
npm run build
```

The bundle is written to `v2/main.js`. On Windows, `npm run package` creates `v2/dist/freedraw-pdf-0.13.2.zip`. `npm run vault:test` creates or refreshes an ignored local test vault at `v2/obsidian`. Each version also has its own package manifest for standalone installation and builds.

Test vaults, PDFs, sidecars, caches, generated bundles, and ZIPs stay outside source control. Release assets contain only the plugin's three installation files. See [contributing](CONTRIBUTING.md) and [security policy](SECURITY.md).

Device testing remains necessary for physical pen latency, palm rejection, pinch zoom and large PDFs. GitHub issue #2 is not claimed resolved. Exports remain flattened PDFs; save recovery depends on writable storage.

Licensed under [MIT](LICENSE).
