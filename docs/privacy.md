# Privacy

Freedraw PDF stores annotations in your vault and does not use analytics. Drawing, viewing, exporting and switching between handwriting and accepted text do not require an online service.

## Handwriting recognition

Online recognition is optional. When you choose **Recognise**, the plugin sends an image of the chosen pen strokes to your configured service, together with the language hint, model and transcription instructions. Your API credential is sent in the request headers.

The recognition image does not include the PDF file, its filename, printed page text, imported images or highlighter strokes. For whole-PDF recognition, handwriting pages are sent separately. A temporary service failure may cause a page to be retried.

**Load models** and **Refresh models** contact the Gemini API using your credential, without sending handwriting. Opening OCR options, switching handwriting/text display and pasting a transcript do not make recognition requests. There is no automatic background OCR.

Cancelling stops the plugin from applying the result. A request already sent to a provider may still finish there. The provider's terms, retention settings and privacy policy apply to its processing.

## Credentials and servers

API credentials are stored in Obsidian's secret storage, separately from ordinary plugin settings and annotation files. Saved credentials are bound to the configured service endpoint. Changing a server URL requires credentials for that destination; returning to the original endpoint retains its saved credential.

Online endpoints require HTTPS. Local-server mode also permits HTTP, which does not encrypt handwriting or authentication in transit. A local-server URL can point to another computer, and that server may forward data to other services. Check how your chosen helper handles data.

A manually pasted transcript does not contact a recognition service through the plugin.

## Files in your vault

The companion **`.annot.json` file** stores editable strokes, accepted transcripts, positions, display preferences and imported image data. Ordinary settings store tool preferences and OCR configuration, including the provider, model, endpoint and language.

Recovery files and local checkpoints may retain earlier annotation content. A local device marker distinguishes checkpoints; the plugin does not send it to a service. Your backup and sync configuration determines where vault files are copied.

Hiding recognised text or deleting visible ink is not secure erasure. Review annotation files, recovery copies and backups before sharing a vault.

## Clipboard, images and exports

Clipboard access is used by copy/paste and diagnostic commands. **Keep handwriting, copy text** uses saved, accepted transcripts from complete recognised selections; it makes no recognition request.

Diagnostics can contain layout information, counts and document element identifiers. They are not uploaded automatically. Review them before sharing.

Annotation images must be embedded image data. The plugin's annotation image loaders reject remote image URLs and local file URLs.

Exports preserve the original PDF content and add annotations. Valid accepted OCR text remains selectable in the exported PDF even when the handwriting is shown. Exporting is not a redaction or anonymisation tool; check the result before sharing it.

For security reports, see the [security policy](../SECURITY.md). For setup, see [handwriting recognition](handwriting-recognition.md).
