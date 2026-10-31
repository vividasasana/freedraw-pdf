import type { NormalizedRect } from "../types";
import type { OcrSettings } from "./model";
import { OcrServiceError, recogniseInk, type OcrResult, type OcrTransport } from "./providers";

/** Bounded recovery for temporary service failures; never retry credentials/model errors. */
export async function recogniseInkWithRetry(settings: OcrSettings, credential: string, image: string, box: NormalizedRect, transport: OcrTransport, clock: Pick<Window, "setTimeout">, isCurrent: () => boolean, onRetry: (attempt: number, delayMs: number, status: number) => void): Promise<OcrResult> {
	for (let attempt = 0; ; attempt++) {
		if (!isCurrent()) throw new Error("Recognition cancelled.");
		try { return await recogniseInk(settings, credential, image, box, transport); }
		catch (error) {
			if (!(error instanceof OcrServiceError) || ![408, 500, 502, 503, 504].includes(error.status) || attempt >= 2 || !isCurrent()) throw error;
			const delay = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
			onRetry(attempt + 1, delay, error.status);
			await new Promise<void>(resolve => clock.setTimeout(resolve, delay));
		}
	}
}
