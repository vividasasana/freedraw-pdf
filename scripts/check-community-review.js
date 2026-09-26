const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const main = read("main.ts");
for (const file of ["main.ts", "src/debug/renderTelemetry.ts"]) {
	assert.ok(!/\bglobalThis\b/.test(read(file)), `${file}: use the owner-window type`);
}
assert.ok(!/\.createElement\(/.test(main), "Use Obsidian DOM helpers");
assert.ok(!/\.createDocumentFragment\(/.test(main), "Use owner-window Obsidian helpers for detached canvases");
assert.ok(!/thumbnailEl as HTMLElement/.test(main), "Thumbnail type is already known");
assert.ok(!/matchingTouch as Touch/.test(main), "Touch type is already known");
assert.match(read("src/pdf/nativePdfJs.ts"), /loadedPdfJs: unknown = await loadPdfJs\(\)/);
assert.ok(!/\bcolumn-gap\s*:/.test(read("styles.css")), "Use grid gap shorthand");
console.log("Community review regression checks passed (targeted checks, not the full remote scanner).");
