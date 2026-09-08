# Contributing to Freedraw PDF

Thanks for helping improve Freedraw PDF. Bug reports, focused fixes, and reproducible test cases are welcome.

## Report a Problem

Open a [GitHub issue](https://github.com/vividasasana/freedraw-pdf/issues) and include:

- Obsidian and Freedraw PDF versions.
- Operating system and input device.
- Clear reproduction steps.
- Expected and actual behavior.
- A screen recording or sample PDF when it can be shared safely.

Do not include private PDFs, vault data, credentials, or other sensitive content.

## Develop Locally

Requirements:

- Node.js 18 or later.
- npm.

```bash
npm install
npm run check
npm run build
```

Use `npm run dev` for watch mode. Test PDF interaction changes with mouse and touch or stylus input when applicable.

## Submit a Change

Keep pull requests focused on one problem. Describe the behavior change, testing performed, and any remaining device-specific limitations.

Before submitting:

1. Run `npm run check`.
2. Run `npm run build`.
3. Confirm no generated files, test PDFs, vault data, or secrets were added unintentionally.
4. Verify controls remain usable in Obsidian desktop and mobile layouts when the change affects UI or input.

By submitting a contribution, you agree that it may be distributed under the repository's [MIT License](LICENSE).
