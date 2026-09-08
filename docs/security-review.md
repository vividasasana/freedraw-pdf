# Safety and privacy review

This review covers the Freedraw PDF 0.13.3 source and release package. The release contains the current plugin only. Earlier local development snapshots, test vaults, PDFs, annotation files, dependencies, logs, and generated output are excluded from source control.

## Controls and checks

- Image loading in the editor, Markdown embeds, and export accepts embedded image data only. Regression checks exercise these paths with remote URLs, local file URLs, and non-image data URLs and verify that none reach the image loader.
- Test deployment copies only `main.js`, `manifest.json`, and `styles.css`, then updates the selected test vault's enabled-plugin list. It preserves existing entries and rejects malformed configuration. Deployment tests verify that notes and settings remain unchanged and that cloud environment variables do not cause a whole-vault copy.
- Repository checks reject local snapshot folders, private file types, unexpected binaries, common credential formats, and personal filesystem paths. The staged check reads the Git index. The existing demonstration screenshot is the only permitted source image and has been visually reviewed.
- The regression suite covers ink rendering and settings preservation, erasing, pointer routing, page insertion, text, selection, save conflicts, delayed writes, recovery copies, and export dimensions. TypeScript and module checks verify the source graph.
- Release automation installs locked dependencies, runs checks, builds the plugin, checks generated assets, and creates a ZIP from exactly the three installation files. Published artifacts have GitHub build attestations.

The dependency audit performed for the preceding build reported no known vulnerabilities. This version retains the same locked dependency entries. An advisory audit does not rule out unknown vulnerabilities.

## Storage and remaining limits

Annotations and imported images are stored in vault files. Clipboard access is connected to copy and paste commands. No analytics service or direct network request API was found in the reviewed plugin source. PDF rendering uses Obsidian's supplied PDF.js; the review does not cover Obsidian or its image decoders.

Indexed sidecar updates use `Vault.process`. Unindexed adapter writes and external sync operations do not have the same atomic coordination. Recovery copies depend on writable storage, and conflicting files require manual reconciliation.

Physical pen latency, palm rejection, pinch zoom, and long PDFs still need testing on devices. Automated browser checks from development use mocked Obsidian host services. This is a bounded source and package review, not a security certification.
