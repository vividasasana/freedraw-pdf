const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const staged = process.argv.includes("--staged");
const git = (args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const read = (file) => staged ? git(["show", `:${file}`]) : fs.readFileSync(path.join(root, file));
const json = (file) => JSON.parse(read(file).toString("utf8"));
const patterns = [
  ["private key", /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/],
  ["credential", /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,})/],
  ["assigned secret", /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][^"']{8,}/i],
  ["personal filesystem path", /(?:[A-Z]:[\\/]Users[\\/][^\\/\s]+|\/(?:Users|home)\/[^/\s]+\/)/i]
];
const privatePath = /(?:^|\/)(?:\.analysis|\.agents|\.codex|\.obsidian|obsidian|test-vault|node_modules|backups|tmp|output|dist)(?:\/|$)|(?:^|\/)(?:context\.md|\.npmrc|\.env(?:\..*)?)$/i;
const imageException = /^(?:v[012]\/)?docs\/images\/freedraw-pdf-annotated-embed-demo\.png$/;
const binaryOrPrivate = /\.(?:pdf|zip|png|jpe?g|gif|webp|bak|log|key|pem|p12|pfx|annot\.json)$/i;
const files = [...new Set(git(staged ? ["ls-files", "--cached", "-z"] : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean))];
let count = 0;
for (const file of files) {
  if (!staged && !fs.existsSync(path.join(root, file))) continue;
  assert.ok(!/^v[012]\//.test(file), `Local snapshot must not be published: ${file}`);
  assert.ok(!privatePath.test(file), `Private/generated path in publication: ${file}`);
  assert.ok(!binaryOrPrivate.test(file) || imageException.test(file), `Unexpected private/binary file: ${file}`);
  assert.ok(!/(?:^|\/)main\.js$/.test(file), `Generated bundle must remain a release asset: ${file}`);
  const data = read(file);
  if (imageException.test(file)) continue;
  assert.ok(!data.includes(0), `Unexpected binary source file: ${file}`);
  for (const [category, pattern] of patterns) {
    assert.ok(!pattern.test(data.toString("utf8")), `Possible ${category} in ${file}; value withheld.`);
  }
  count++;
}
const manifest = json("manifest.json"), pkg = json("package.json"), lock = json("package-lock.json");
assert.equal(pkg.version, manifest.version, "Manifest/package version mismatch");
assert.equal(lock.version, pkg.version, "Lockfile version mismatch");
assert.equal(lock.packages[""].version, pkg.version);
assert.equal(manifest.id, "freedraw-pdf");
assert.equal(json("versions.json")[manifest.version], manifest.minAppVersion);
assert.ok(/^0\.13\.\d+$/.test(manifest.version), "Use the plugin 0.13.x version series");
const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) assert.equal(process.argv[tagIndex + 1], manifest.version, "Tag must match plugin version");
console.log(`Repository privacy/layout passed: ${count} ${staged ? "staged" : "candidate"} text files; one plugin at the root.`);
