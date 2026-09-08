const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const requests = [];
class FakeImage {
  set src(value) { requests.push(value); this.onload?.(); }
}
const cache = new Map();
function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Image: FakeImage,
    require: (name) => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), name + ".ts"))) : require(name)
  }, { filename });
  return module.exports;
}
async function main() {
  const { isEmbeddedImageDataUrl } = load("src/utils/imageData.ts");
  const { renderAnnotationDocumentPageImages } = load("src/markdown/embedRender.ts");
  const mainSource = fs.readFileSync(path.join(root, "main.ts"), "utf8");
  const starts = ["\tprivate getImageDataUrlDimensions(", "\tprivate drawImageAnnotation("];
  const methods = starts.map((start) => {
    const a = mainSource.indexOf(start), b = mainSource.indexOf("\n\tprivate ", a + start.length);
    assert.ok(a >= 0 && b > a);
    return mainSource.slice(a, b);
  }).join("\n");
  const scope = { Image: FakeImage, isEmbeddedImageDataUrl };
  vm.runInNewContext(ts.transpileModule("class Session {" + methods + "}globalThis.Session=Session;", { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
  const session = new scope.Session();
  for (const dataUrl of ["https://example.invalid/tracker.png", "//example.invalid/tracker", "file:///private.png", "javascript:void(0)", "data:text/html,<script></script>", "data:image/png;broken", null, {}]) {
    const item = { page: 1, dataUrl };
    session.drawImageAnnotation({}, {}, item);
    await assert.rejects(() => session.getImageDataUrlDimensions(dataUrl), /embedded image data/);
    await assert.rejects(() => renderAnnotationDocumentPageImages({}, { imageItems: [item] }, 1, 100, 100), /embedded image data/);
  }
  assert.equal(requests.length, 0, "Invalid sidecar images must not reach Image.src in editor, embeds or export");
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  let draws = 0;
  await renderAnnotationDocumentPageImages({ drawImage() { draws++; } }, { imageItems: [{ page: 1, dataUrl, x: 0, y: 0, widthScale: 1, heightScale: 1 }] }, 1, 100, 100);
  assert.equal(draws, 1);
  assert.deepEqual(requests, [dataUrl]);
  console.log("Image privacy passed: remote, file and non-image sources blocked at all three loading paths; embedded images retained.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
