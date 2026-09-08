export interface PdfImagePage {
	widthPx: number;
	heightPx: number;
	jpegBytes: Uint8Array;
}

const PDF_EXPORT_DPI = 144;

function encodeAscii(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function buildPdfFromJpegPages(pages: PdfImagePage[]): Uint8Array {
	if (pages.length === 0) {
		throw new Error("Cannot build a PDF without pages.");
	}

	const chunks: Uint8Array[] = [encodeAscii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
	const offsets: number[] = [0];
	let byteOffset = chunks[0].length;
	const push = (chunk: Uint8Array): void => {
		chunks.push(chunk);
		byteOffset += chunk.length;
	};
	const pushObject = (objectNumber: number, body: Uint8Array | string): void => {
		offsets[objectNumber] = byteOffset;
		push(encodeAscii(`${objectNumber} 0 obj\n`));
		push(typeof body === "string" ? encodeAscii(body) : body);
		push(encodeAscii("\nendobj\n"));
	};

	const pageObjectNumbers = pages.map((_, index) => 3 + (index * 3));
	const kids = pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(" ");
	pushObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
	pushObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

	pages.forEach((page, index) => {
		const pageObject = 3 + (index * 3);
		const contentObject = pageObject + 1;
		const imageObject = pageObject + 2;
		const widthPt = page.widthPx * 72 / PDF_EXPORT_DPI;
		const heightPt = page.heightPx * 72 / PDF_EXPORT_DPI;
		const drawCommand = `q\n${formatNumber(widthPt)} 0 0 ${formatNumber(heightPt)} 0 0 cm\n/Im${index} Do\nQ\n`;
		const contentBytes = encodeAscii(drawCommand);
		pushObject(pageObject, [
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(widthPt)} ${formatNumber(heightPt)}] `,
			`/Resources << /XObject << /Im${index} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
		].join(""));
		pushObject(contentObject, concatBytes([
			encodeAscii(`<< /Length ${contentBytes.length} >>\nstream\n`),
			contentBytes,
			encodeAscii("endstream")
		]));
		pushObject(imageObject, concatBytes([
			encodeAscii([
				`<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx}`,
				" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
				` /Length ${page.jpegBytes.length} >>\nstream\n`
			].join("")),
			page.jpegBytes,
			encodeAscii("\nendstream")
		]));
	});

	const xrefOffset = byteOffset;
	const objectCount = 2 + (pages.length * 3);
	push(encodeAscii(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`));
	for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
		push(encodeAscii(`${String(offsets[objectNumber] ?? 0).padStart(10, "0")} 00000 n \n`));
	}
	push(encodeAscii(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
	return concatBytes(chunks);
}
