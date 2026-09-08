const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const vaultRoot = path.join(projectRoot, "obsidian");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const pluginRoot = path.join(vaultRoot, ".obsidian", "plugins", manifest.id);
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

function assertInsideProject(targetPath) {
	const relativePath = path.relative(projectRoot, path.resolve(targetPath));
	if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		throw new Error(`Refusing to write outside the plugin project: ${targetPath}`);
	}
}

function ensureDirectory(directoryPath) {
	assertInsideProject(directoryPath);
	fs.mkdirSync(directoryPath, { recursive: true });
}

function writeText(filePath, content, { preserveExisting = false } = {}) {
	assertInsideProject(filePath);
	if (preserveExisting && fs.existsSync(filePath)) {
		return;
	}
	ensureDirectory(path.dirname(filePath));
	fs.writeFileSync(filePath, content, "utf8");
}

function syncCommunityPlugins(filePath) {
	let enabledPlugins = [];
	if (fs.existsSync(filePath)) {
		enabledPlugins = JSON.parse(fs.readFileSync(filePath, "utf8"));
	}
	if (!Array.isArray(enabledPlugins) || enabledPlugins.some((entry) => typeof entry !== "string")) {
		throw new Error("Invalid community-plugins.json; original left unchanged.");
	}
	if (!enabledPlugins.includes(manifest.id)) {
		enabledPlugins.push(manifest.id);
	}
	writeText(filePath, `${JSON.stringify(enabledPlugins, null, 2)}\n`);
}

function buildSamplePdf() {
	const pageOneStream = [
		"0.93 0.96 1 rg 48 90 516 630 re f",
		"0.35 0.44 0.62 RG 1 w 72 650 m 540 650 l S",
		"BT /F1 24 Tf 72 710 Td (Freedraw PDF test - page 1) Tj ET",
		"BT /F1 12 Tf 72 620 Td (Use this page for pen, pressure, eraser, text, image and selection tests.) Tj ET",
		"BT /F1 12 Tf 72 592 Td (Pinch zoom and finger pan repeatedly, then confirm the page stays anchored.) Tj ET"
	].join("\n");
	const pageTwoStream = [
		"0.96 0.94 1 rg 48 90 516 630 re f",
		"0.47 0.33 0.62 RG 1 w 72 650 m 540 650 l S",
		"BT /F1 24 Tf 72 710 Td (Freedraw PDF test - page 2) Tj ET",
		"BT /F1 12 Tf 72 620 Td (Use Pages and template menus, then move between both PDF pages.) Tj ET",
		"BT /F1 12 Tf 72 592 Td (Check that popovers close when another menu opens.) Tj ET"
	].join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(pageOneStream, "ascii")} >>\nstream\n${pageOneStream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
		`<< /Length ${Buffer.byteLength(pageTwoStream, "ascii")} >>\nstream\n${pageTwoStream}\nendstream`
	];

	let pdf = "%PDF-1.4\n% Freedraw PDF test document\n";
	const offsets = [0];
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(pdf, "ascii"));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xrefOffset = Buffer.byteLength(pdf, "ascii");
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += "0000000000 65535 f \n";
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf, "ascii");
}

function verifyVault() {
	const requiredFiles = [
		path.join(vaultRoot, "Start Here.md"),
		path.join(vaultRoot, "Test PDF.pdf"),
		path.join(vaultRoot, ".obsidian", "community-plugins.json"),
		...releaseFiles.map((fileName) => path.join(pluginRoot, fileName))
	];
	for (const filePath of requiredFiles) {
		if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
			throw new Error(`Test vault is missing a required file: ${filePath}`);
		}
	}
	const installedManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.json"), "utf8"));
	if (installedManifest.id !== manifest.id || installedManifest.version !== manifest.version) {
		throw new Error("Installed test-vault manifest does not match the plugin release manifest.");
	}
	const installedMain = fs.readFileSync(path.join(pluginRoot, "main.js"));
	const releaseMain = fs.readFileSync(path.join(projectRoot, "main.js"));
	if (!installedMain.equals(releaseMain)) {
		throw new Error("Installed test-vault main.js does not match the plugin build.");
	}
	const samplePdf = fs.readFileSync(path.join(vaultRoot, "Test PDF.pdf"));
	const samplePdfText = samplePdf.toString("ascii");
	if (!samplePdfText.startsWith("%PDF-1.4\n") || !samplePdfText.endsWith("%%EOF\n")) {
		throw new Error("Test PDF does not have a complete PDF header and trailer.");
	}
	const startXrefMatch = samplePdfText.match(/startxref\n(\d+)\n%%EOF\n$/);
	if (!startXrefMatch || samplePdfText.slice(Number(startXrefMatch[1]), Number(startXrefMatch[1]) + 5) !== "xref\n") {
		throw new Error("Test PDF has an invalid cross-reference offset.");
	}
	for (let objectNumber = 1; objectNumber <= 7; objectNumber += 1) {
		if (!samplePdfText.includes(`${objectNumber} 0 obj\n`)) {
			throw new Error(`Test PDF is missing object ${objectNumber}.`);
		}
	}
}

for (const fileName of releaseFiles) {
	const sourcePath = path.join(projectRoot, fileName);
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`Build the plugin before creating the test vault; missing ${fileName}.`);
	}
}

ensureDirectory(pluginRoot);
for (const fileName of releaseFiles) {
	const destinationPath = path.join(pluginRoot, fileName);
	assertInsideProject(destinationPath);
	fs.copyFileSync(path.join(projectRoot, fileName), destinationPath);
}

writeText(path.join(vaultRoot, ".obsidian", "app.json"), "{}\n", { preserveExisting: true });
syncCommunityPlugins(path.join(vaultRoot, ".obsidian", "community-plugins.json"));
writeText(
	path.join(vaultRoot, "Start Here.md"),
	`# Freedraw PDF test vault

This vault contains the current **v2** build. The original project outside \`v2\` is not used by this vault.

1. Open this folder as a vault in Obsidian.
2. If Obsidian asks, trust the vault and enable **Freedraw PDF** under **Settings → Community plugins**.
3. Open [[Test PDF.pdf]], choose **Annotate**, and test with your pen, one-finger pan, and two-finger pinch zoom.

While annotating, **1 = Pen, 2 = Highlighter, 3 = Eraser, 4 = Select, 5 = Text**. These keys remain ordinary text inside an editor.

Change **Settings → Freedraw PDF → Stabilization**: 0 disables path stabilization; higher values smooth more strongly. Changes affect only new strokes; existing ink keeps its appearance.

Create a new PDF to start with a white blank page. In **Page**, use **Template** and **Paper** to change its overlay style and colour. **Quick add after current** inserts the temporary page directly after the page where the menu was opened.

## Focused checks

- Pencil draws while one finger pans; touch pan does not display the eraser pointer.
- Live pressure and width closely match the committed stroke; adjust smoothing in plugin settings.
- Existing strokes appear immediately and erased segments have smooth rounded ends.
- Repeated pinch zoom does not jump to page 1, flash upward, shift text, or lose page backgrounds.
- Opening **Pages**, tool, selection, or overflow menus closes any previous menu.
- Selection cursors remain stable: crosshair while drawing a region, pan/move inside a selected region.
- Text, shape, image, and mixed selection boxes share the same appearance.
- New text starts in a stable, vertically centred box; its caret looks native and touching text produces only a subtle highlight.
- Drag the PDF scrollbar and scroll with a trackpad or finger; existing-stroke rendering should not make motion stutter.
- Press **Esc** outside an active text edit or popup to leave annotation mode.
- Insert and select an image, then move, resize, and pan around it.

The vault keeps your test annotations and plugin settings when the vault:test command is run again; only the three plugin release files are refreshed.
`,
	{ preserveExisting: true }
);

const samplePdfPath = path.join(vaultRoot, "Test PDF.pdf");
if (!fs.existsSync(samplePdfPath)) {
	assertInsideProject(samplePdfPath);
	fs.writeFileSync(samplePdfPath, buildSamplePdf());
}

verifyVault();
console.log(`Test vault ready: ${vaultRoot}`);
console.log(`Installed ${manifest.id} ${manifest.version} into ${pluginRoot}`);
