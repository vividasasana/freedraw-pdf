# Contributing to Freedraw PDF

Thanks for helping improve Freedraw PDF. Bug reports, focused fixes, and reproducible test cases are welcome.

## Report a problem

Open a [GitHub issue](https://github.com/vividasasana/freedraw-pdf/issues) and include:

- Obsidian and Freedraw PDF versions.
- Operating system and input device.
- Clear reproduction steps.
- Expected and actual behavior.
- A screen recording or sample PDF when it can be shared safely.

Do not include private PDFs, vault data, credentials, or other sensitive content.

## Develop locally

Requirements:

- Node.js 24 (matching CI).
- npm.

```bash
npm ci
npm run check
npm run build
```

The repository root contains the current plugin. Work in `main.ts` and `src/`. Local snapshots and test vaults are ignored and must stay out of commits.

Use `npm run dev` for watch mode. Test PDF interaction changes with mouse and touch or stylus input when applicable.

## Submit a change

Keep pull requests focused on one problem. Describe the behavior change, testing performed, and any remaining device-specific limitations.

Before submitting:

1. Run `npm run check`.
2. Run `npm run build`.
3. Confirm no generated files, test PDFs, vault data, or secrets were added unintentionally.
4. Verify controls remain usable in Obsidian desktop and mobile layouts when the change affects UI or input.

By submitting a contribution, you agree that it may be distributed under the repository's [MIT License](LICENSE).

## Prepare a release

Use the next unused version in the 0.13.x series, such as `0.13.3`. Keep `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` consistent. The Git tag must be the version alone, without a prefix or development-folder name.

Add release notes in `docs/releases/`, run the checks and production build, then push the version tag. GitHub Actions publishes the plugin files and ZIP from the tagged source. On Windows, `npm run package` creates a local ZIP in `dist/`.
