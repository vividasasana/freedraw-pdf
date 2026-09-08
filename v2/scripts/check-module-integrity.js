const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const configPath = path.join(projectRoot, "tsconfig.json");

function fail(message) {
	throw new Error(message);
}

function normalize(filePath) {
	return path.normalize(path.resolve(filePath));
}

const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
if (rawConfig.error) {
	fail(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, "\n"));
}
const parsedConfig = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, projectRoot);
const compilerOptions = {
	...parsedConfig.options,
	noEmit: true,
	noUnusedLocals: true,
	noUnusedParameters: true
};
const program = ts.createProgram(parsedConfig.fileNames, compilerOptions);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
	process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getCanonicalFileName: (fileName) => fileName,
		getCurrentDirectory: () => projectRoot,
		getNewLine: () => "\n"
	}));
	process.exit(1);
}

const sourceFiles = program.getSourceFiles().filter((sourceFile) => {
	const relativePath = path.relative(projectRoot, sourceFile.fileName);
	return relativePath === "main.ts" || relativePath.startsWith(`src${path.sep}`);
});
const sourcePaths = new Set(sourceFiles.map((sourceFile) => normalize(sourceFile.fileName)));
const dependencies = new Map();
for (const sourceFile of sourceFiles) {
	const imports = [];
	for (const statement of sourceFile.statements) {
		if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
			|| !statement.moduleSpecifier
			|| !ts.isStringLiteral(statement.moduleSpecifier)
			|| !statement.moduleSpecifier.text.startsWith(".")) {
			continue;
		}
		const resolved = ts.resolveModuleName(
			statement.moduleSpecifier.text,
			sourceFile.fileName,
			compilerOptions,
			ts.sys
		).resolvedModule?.resolvedFileName;
		if (resolved && sourcePaths.has(normalize(resolved))) {
			imports.push(normalize(resolved));
		}
	}
	dependencies.set(normalize(sourceFile.fileName), imports);
}

const entryPath = normalize(path.join(projectRoot, "main.ts"));
const reachable = new Set();
function visit(filePath) {
	if (reachable.has(filePath)) {
		return;
	}
	reachable.add(filePath);
	for (const dependency of dependencies.get(filePath) ?? []) {
		visit(dependency);
	}
}
visit(entryPath);
const orphanModules = [...sourcePaths].filter((filePath) => !reachable.has(filePath));
if (orphanModules.length > 0) {
	fail(`Source modules are not reachable from main.ts:\n${orphanModules.map((filePath) => path.relative(projectRoot, filePath)).join("\n")}`);
}

const sourceText = sourceFiles.map((sourceFile) => sourceFile.text).join("\n");
const styles = fs.readFileSync(path.join(projectRoot, "styles.css"), "utf8");
const pluginCssClasses = new Set(
	[...styles.matchAll(/\.(?:pdf-native-annotator|freedraw-pdf)[A-Za-z0-9_-]*/g)]
		.map((match) => match[0].slice(1))
);
const staleCssClasses = [...pluginCssClasses].filter((className) => !sourceText.includes(className));
if (staleCssClasses.length > 0) {
	fail(`Plugin CSS classes have no source reference:\n${staleCssClasses.join("\n")}`);
}

console.log(`Module integrity verifier passed. sourceModules=${sourceFiles.length}; reachable=${reachable.size}; pluginCssClasses=${pluginCssClasses.size}`);
