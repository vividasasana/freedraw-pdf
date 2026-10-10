const path = require("path");
const { existsSync } = require("fs");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
// check-runtime-efficiency.js targets the withdrawn 0.13.4 implementation.
// This candidate uses the v2 rendering/ink tests plus the issue #2 replay below.
const checks = [
	"check-repository.js",
	"check-module-integrity.js",
	"check-community-review.js",
	"check-mixed-document.js",
	"check-ink-engine.js",
	"check-handwriting-regressions.js",
	"check-pressure-response.js",
	"check-round-smoothing.js",
	"check-preview-modes.js",
	"check-smooth-edges.js",
	"check-continuous-ink.js",
	"check-vector-display.js",
	"check-vector-zoom.js",
	"check-input-policy.js",
	"check-issue-2.js",
	"check-eraser-migration.js",
	"check-render-concurrency.js",
	"check-template-consistency.js",
	"check-session-commands.js",
	"check-transient-popovers.js",
	"check-menu-descriptors.js",
	"check-toolbar-usability.js",
	"check-text-formatting.js",
	"check-interaction-polish.js",
	"check-zoom-selection-stability.js",
	"check-release-hygiene.js",
	"check-v2-reliability.js",
	"check-save-sync.js",
	"check-v2-interactions.js",
	"check-v2-rendering.js",
	"check-v2-page-flow.js",
	"check-quick-add-pages.js",
	"check-settings-ux.js",
	"check-file-tree-picker.js",
	"check-pan-text-handoff.js",
	"check-json-cases-sync.js",
	"check-v2-stroke-settings.js",
	"check-v2-privacy.js"
];
if (existsSync(path.join(projectRoot, "main.js"))) checks.push("check-built-plugin.js");

for (const check of checks) {
	const result = spawnSync(process.execPath, [path.join(__dirname, check)], {
		cwd: projectRoot,
		stdio: "inherit"
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
