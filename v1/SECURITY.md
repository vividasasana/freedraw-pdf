# Security Policy

## Reporting

Please report security issues through GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, open a minimal GitHub issue that says a security report is available and do not include secrets, exploit details, private vault paths, or personal data in the issue body.

## Publishing Safety

Before publishing a release or submitting this plugin to a community directory:

- Run the project checks and production build.
- Confirm release assets are only `manifest.json`, generated `main.js`, and `styles.css`.
- Confirm source control does not contain vault data, local paths, test PDFs, screenshots, exported annotations, logs, credentials, or generated archives.
- Confirm Git history is clean before pushing to a public repository.
