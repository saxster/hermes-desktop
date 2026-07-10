/** Keep the heavyweight Tesseract worker out of the initial renderer graph. */
export async function ocrImageBlobToText(
  blob: Blob,
): Promise<string> {
  const module = await import("./ocr");
  return module.ocrImageBlobToText(blob);
}
