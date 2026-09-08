const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const releaseFiles = ["main.js", "manifest.json", "styles.css"];
const generatedReleaseFiles = new Set(["main.js"]);
const allowedBinaryFiles = new Set(["docs/images/freedraw-pdf-annotated-embed-demo.png"]);
const forbiddenExtensions = new Set([
	".annot.json",
	".bak",
	".env",
	".gif",
	".jpeg",
	".jpg",
	".key",
	".log",
	".p12",
	".pem",
	".pdf",
	".pfx",
	".png",
	".webp",
	".zip"
]);
const textExtensions = new Set([
	"",
	".css",
	".gitattributes",
	".gitignore",
	".js",
	".json",
	".md",
	".mjs",
	".ps1",
	".ts",
	".txt",
	".yaml",
	".yml"
]);
const sensitivePatterns = [
	{ name: "private key", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
	{ name: "cloud credential", pattern: /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,})/ },
	{ name: "assigned secret", pattern: /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][^"']{8,}/i },
	{ name: "authorization credential", pattern: /authorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}/i },
	{ name: "local Windows user path", pattern: /[A-Z]:\\Users\\[^\\\s]+/i },
	{ name: "local Unix user path", pattern: /\/(?:Users|home)\/[^/\s]+\// }
];

function fail(message) {
	throw new Error(message);
}

function normalizeRelativePath(filePath) {
	return filePath.replaceAll("\\", "/");
}

function getCandidateFiles() {
	const output = execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ cwd: projectRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
	);
	return output.split("\0").filter(Boolean).map(normalizeRelativePath);
}

function getSensitiveCategory(content) {
	return sensitivePatterns.find(({ pattern }) => pattern.test(content))?.name ?? null;
}

const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(projectRoot, "versions.json"), "utf8"));
if (manifest.version !== packageJson.version) {
	fail("manifest.json and package.json versions do not match.");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	fail("versions.json does not map the release version to manifest.json minAppVersion.");
}

for (const relativePath of releaseFiles) {
	const absolutePath = path.join(projectRoot, relativePath);
	if (!fs.existsSync(absolutePath)) {
		if (generatedReleaseFiles.has(relativePath)) {
			continue;
		}
		fail(`Missing release asset: ${relativePath}`);
	}
	const category = getSensitiveCategory(fs.readFileSync(absolutePath, "utf8"));
	if (category) {
		fail(`Release asset ${relativePath} contains a possible ${category}; value withheld.`);
	}
}

let scannedTextFiles = 0;
for (const relativePath of getCandidateFiles()) {
	const lowerPath = relativePath.toLowerCase();
	const extension = lowerPath.endsWith(".annot.json") ? ".annot.json" : path.extname(lowerPath);
	if (forbiddenExtensions.has(extension) && !allowedBinaryFiles.has(relativePath)) {
		fail(`Repository candidate must remain private/generated: ${relativePath}`);
	}
	if (!textExtensions.has(extension)) {
		continue;
	}
	const absolutePath = path.join(projectRoot, relativePath);
	if (!fs.existsSync(absolutePath)) {
		continue;
	}
	const category = getSensitiveCategory(fs.readFileSync(absolutePath, "utf8"));
	if (category) {
		fail(`Repository candidate ${relativePath} contains a possible ${category}; value withheld.`);
	}
	scannedTextFiles += 1;
}

console.log(`Release hygiene verifier passed. releaseAssets=${releaseFiles.length}; repositoryTextFiles=${scannedTextFiles}`);
