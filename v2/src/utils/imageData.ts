/** Sidecars may be shared or edited externally; never load their image URLs from the network. */
export function isEmbeddedImageDataUrl(value: unknown): value is string {
	return typeof value === "string" && /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=+.-]+)*,/i.test(value);
}
