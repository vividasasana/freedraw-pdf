const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");

// A copied development snapshot has no Git index of its own. Never inspect its
// parent's publication index in place of the actual snapshot source files.
module.exports = function repositoryFiles(root, staged = false) {
  let gitRoot = "";
  try { gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  if (gitRoot && path.resolve(gitRoot).toLowerCase() === path.resolve(root).toLowerCase()) {
    return execFileSync("git", staged ? ["ls-files", "--cached", "-z"] : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
  }
  if (staged) throw Error("This snapshot has no independent Git index to check.");
  const excluded = new Set(["node_modules", "tmp", "dist", "output", "backups", ".git", ".analysis", ".playwright-cli", ".playwright", "test-vault", "obsidian"]);
  const files = [];
  function walk(folder, prefix = "") {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name.endsWith(".log") || entry.name === "main.js") continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), relative + "/");
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk(root);
  return files;
};
