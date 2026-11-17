import { extractText, getDocumentProxy } from "unpdf";

/**
 * Text of a PDF CV, for the scorer. Layout-heavy PDFs (two columns, icons)
 * can come out jumbled, which is why the result stays editable on the Profile page.
 * Returns "" for scanned/image-only PDFs, which have no text layer.
 */
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  // pdf.js takes over ("detaches") the buffer it's given, so hand it a copy:
  // the caller still needs the original bytes for the upload.
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_CV_BYTES = 5 * 1024 * 1024;
