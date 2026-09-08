# Safety and privacy review — 0.13.2

Reviewed on 2026-09-08 before publication. Scope: active v2 source and package, save/recovery behavior, deployment scripts, repository publication candidates across v0/v1/v2, and locked dependencies. V0/v1 are historical plugin implementations; they are not recommended for new installations.

## Findings addressed

### PRIVACY-001 — Medium — automatic whole-vault cloud copying

The inherited deployment script selected a OneDrive destination automatically and recursively copied every item in the test vault. This could copy notes, PDFs, annotations and plugin configuration into cloud storage when the user only intended to install a test build.

**Fixed in all three deployment scripts.** [The v2 script](../v2/scripts/deploy-test.ps1#L1) accepts an explicit vault parameter or environment setting and otherwise uses its local test vault. Its copy loop is restricted to the three release assets. Automatic OneDrive destination discovery and whole-vault copying are removed. The script also updates the selected vault's enabled-plugin list, preserving existing entries.

Evidence: the previous code looped over `Get-ChildItem` of the entire vault and used `Copy-Item -Recurse`. The replacement uses `foreach ($file in $requiredFiles)` with `manifest.json`, `main.js`, and `styles.css`. [Deployment regression tests](../scripts/check-deployment.ps1) exercise all three versions with cloud environment variables set; the cloud directory remains empty and unrelated notes/settings remain byte-identical.

### PRIVACY-002 — Medium — network image URLs accepted from sidecars

Image annotation data from a sidecar was assigned directly to `Image.src` in the editor and in embed/export rendering. A shared or externally edited sidecar could substitute an HTTP URL and reveal that the document was opened, along with network request metadata. This is a privacy issue; arbitrary script execution was not established.

**Fixed in v2.** [Embedded image validation](../v2/src/utils/imageData.ts) now guards the editor's dimension and rendering paths and [embed/export image loading](../v2/src/markdown/embedRender.ts#L153). Network URLs, local file URLs and non-image data URLs are rejected before creating a load request. Original sidecar records are not deleted. Standard imported images remain embedded data URLs; a blocked image prevents export instead of silently fetching it.

Evidence: [image privacy regressions](../v2/scripts/check-v2-privacy.js) exercise the actual three loading paths with hostile URL schemes and verify no assignment reaches `Image.src`. An embedded PNG still reaches rendering. The test uses a fake image loader; it does not validate every browser image decoder.

### SAFETY-001 — Low — malformed test-vault configuration was reset

The inherited test tooling replaced unreadable enabled-plugin configuration with an empty list. This could discard existing enablement information.

**Fixed for deployment in all versions and for v2 test-vault creation.** Malformed JSON or invalid list entries now cause an error while preserving the original file. Deployment validates this before copying assets. Tests cover malformed JSON, objects, null entries and non-string entries. Normal lists retain other enabled plugins. Packaging no longer calls the test-vault generator.

## Checks and evidence

- All **21 v2 check groups** pass, including TypeScript/module integrity, ink settings preservation, eraser geometry, pointer routing, page insertion, save conflicts, delayed writes, recovery copies, export dimensions and image privacy.
- Production build succeeds; all **39 source modules** are reachable from the plugin entry point.
- ZIP inspection confirms exactly three files: `main.js`, `manifest.json`, `styles.css`. Their SHA-256 hashes match the production build and the ignored local test-vault installation. Source maps, vault content and developer tooling are absent from the package.
- `npm audit --json` for the v2 lockfile reports **0 known vulnerabilities** across all reported severity levels, including development dependencies. This is a point-in-time advisory check, not a guarantee against unknown vulnerabilities.
- [Repository checks](../scripts/check-repository.js) cover all version folders, root metadata consistency, unexpected binaries/private paths, known credential formats and personal filesystem paths. The `--staged` mode reads Git's index, so publication checks inspect the exact staged contents. The only permitted source image is the existing public demonstration artwork, which was visually reviewed.
- Root build/release automation targets v2. Root Obsidian discovery metadata mirrors v2. CI uses locked dependency installation and read-only permissions; the release job receives publication and attestation permissions.

No credentials, personal vault files, private PDFs, annotation sidecars, logs or machine-specific user paths were found in the reviewed publication candidates or release assets. Local test vaults, output, dependencies, backups and analysis artifacts remain ignored. The release branch is based on the existing GitHub 0.12.10 commit; unrelated local history is not included in the push.

## Data behavior and remaining limits

No analytics service or direct network request API was found in active plugin source. PDF rendering uses Obsidian's provided PDF.js. Text labels use text/value/canvas APIs; no untrusted HTML insertion or dynamic code evaluation was found in active source. Clipboard access is connected to copy/paste commands. Annotation sidecars and recovery copies contain document paths relative to the vault and editable content; they are ordinary vault files, subject to the user's vault storage and sync configuration.

Save tests verify serialized writes, protected invalid loads, conflict detection and attempted recovery copies. Indexed updates use `Vault.process`; unindexed adapter writes and simultaneous external sync operations do not have the same atomic coordination. Recovery cannot succeed on unwritable storage, and conflicting sidecars require manual reconciliation. No automatic merge is claimed.

Physical pen latency, palm rejection, pinch zoom, long PDFs and Obsidian host integration still need device testing. The browser harness from development uses mocked host services. GitHub issue #2 remains unconfirmed. Archived v0/v1 runtime behavior is preserved, including older limitations; the runtime image-loading hardening belongs to v2. This review is bounded source/package verification, not a penetration-test certification or a review of Obsidian itself.
