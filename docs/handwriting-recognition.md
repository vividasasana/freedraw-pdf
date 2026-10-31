# Handwriting recognition

Recognise pen handwriting, review the transcript and choose whether to display the original ink or read-only text. Original strokes stay saved.

## Set up a service

Open **Settings → Freedraw PDF → Handwriting recognition**, or choose **Configure** from the handwriting recognition menu.

| Service | What you need |
| --- | --- |
| Gemini | Your Gemini API key. Choose **Load models** or **Refresh models**, then select an available image-capable model. |
| OpenAI-compatible service | An API key, an image-capable model and the full chat/completions endpoint. |
| Local OCR server | A separately running helper, its full HTTP/HTTPS endpoint, and any token or model it requires. |

Online services use your own API account and may charge for requests. An app subscription does not necessarily include API access. The plugin does not install or start a local recognition helper. On an iPad, `localhost` refers to the iPad, not your desktop computer.

Credentials use Obsidian secret storage and are bound to the configured service endpoint. See [Privacy](privacy.md) for what is sent and stored.

## Recognise handwriting

1. Open **Handwriting recognition** from the PDF toolbar. If the button is hidden, use **More → Handwriting recognition (OCR)**.
2. Choose **Current page**, **Selected handwriting** or **Whole PDF**. For a selection, first select the pen strokes with the selection tool.
3. Choose **Recognise**, review or correct the transcript, then accept it.
4. Use the handwriting/text control to switch the current page's display. Switching uses the saved result and does not run recognition again.

Only the chosen pen handwriting is used. Printed PDF content, images and highlighter strokes are excluded. Cancelling leaves the handwriting unchanged. Check names, symbols, maths and scientific notation carefully before accepting a result.

**Paste transcript** lets you use text recognised by another app or device without contacting a service through the plugin.

## Keep handwriting and copy its text

Enable **Keep handwriting, copy text** to keep new accepted results displayed as ink. For an existing text result, choose **Handwriting** to show its strokes again.

Select a complete recognised passage and use Copy or Ctrl/Cmd+C to copy its accepted transcript as plain text. Unicode and line breaks are preserved. This uses saved text without another recognition request.

**Copy handwriting** still copies editable annotations. Cut, Duplicate and mixed selections keep their annotation behaviour. Incomplete, changed or unrecognised passages cannot provide a reliable transcript; select a complete recognised passage or copy its handwriting instead. This setting is off by default.

## Saving and export

Accepted text, positions and display mode are saved beside the original strokes in the annotation file. Moving recognised handwriting preserves its associated text. Changes that make a result stale prevent it from being applied or reused.

The visible export follows the chosen handwriting/text display. Valid accepted OCR text remains selectable in either mode. Keep the original PDF and annotation file to continue editing. Older plugin versions may discard OCR metadata when saving, so use compatible versions across devices.

Text placement is an estimate. A response without line positions is displayed as an approximate text block. Correcting a transcript while keeping its line count retains the returned line positions; other edits use a block.

## For local-helper developers

The plugin sends a POST request to the configured endpoint, with an optional Bearer authentication header:

```json
{"format":"freedraw-ocr-v1","image":"data:image/png;base64,...","language":"English","model":""}
```

Return a successful HTTP status and JSON:

```json
{
  "text": "First line\nSecond line",
  "lines": [
    {"text":"First line","box":{"left":0.1,"top":0.1,"right":0.9,"bottom":0.4}},
    {"text":"Second line","box":{"left":0.1,"top":0.5,"right":0.9,"bottom":0.9}}
  ]
}
```

Boxes use coordinates from 0 to 1 within the supplied cropped image, measured from its top-left corner. The plugin maps them back to the PDF page. A text-only response is also supported.

Recognition runs on request, with one active job per PDF session and a 90-second request timeout. There is no persistent background retry queue. Cancelled requests cannot apply a result, although remote processing may already be underway.
