import { UploadedDocument } from "@/types/pcr";

// PDF.js — use the legacy build for broad browser support and configure the worker
// from the same package so Vite bundles it correctly.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import mammoth from "mammoth";
import * as XLSX from "xlsx";

const MAX_CHARS_PER_DOC = 60_000; // ~15k tokens — large enough for most clinical packets

export interface ExtractedDoc {
  category: string;
  name: string;
  text: string;
  /** True when extraction produced usable readable text. */
  ok: boolean;
  /** Human-readable note when extraction failed or was partial. */
  note?: string;
}

export async function extractTextFromDocuments(
  documents: UploadedDocument[]
): Promise<ExtractedDoc[]> {
  const results: ExtractedDoc[] = [];

  for (const doc of documents) {
    const lower = doc.name.toLowerCase();
    const mime = doc.file.type;
    let text = "";
    let ok = false;
    let note: string | undefined;

    try {
      if (
        mime === "text/plain" ||
        mime === "text/csv" ||
        lower.endsWith(".txt") ||
        lower.endsWith(".csv")
      ) {
        text = await doc.file.text();
        ok = text.trim().length > 0;
      } else if (lower.endsWith(".pdf") || mime === "application/pdf") {
        text = await extractPdfText(doc.file);
        ok = text.trim().length > 0;
        if (!ok) {
          note =
            "PDF contained no extractable text (likely a scanned image). OCR is required — re-export this document as text-based PDF or upload a typed version.";
        }
      } else if (
        lower.endsWith(".docx") ||
        mime ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const buf = await doc.file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        text = result.value || "";
        ok = text.trim().length > 0;
      } else if (
        lower.endsWith(".xlsx") ||
        lower.endsWith(".xls") ||
        mime ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ) {
        text = await extractXlsxText(doc.file);
        ok = text.trim().length > 0;
      } else if (lower.endsWith(".doc")) {
        note =
          "Legacy .doc format is not supported in-browser. Save the file as .docx or .pdf and re-upload.";
      } else {
        // Unknown — try plain text as last resort, but validate it looks like text
        const raw = await doc.file.text();
        if (looksLikeReadableText(raw)) {
          text = raw;
          ok = text.trim().length > 0;
        } else {
          note = `Unsupported or binary file format (${mime || "unknown"}). Upload PDF (text-based), DOCX, XLSX, TXT, or CSV.`;
        }
      }
    } catch (err) {
      note = `Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (text.length > MAX_CHARS_PER_DOC) {
      text = text.slice(0, MAX_CHARS_PER_DOC) + "\n[...TRUNCATED...]";
    }

    results.push({
      category: doc.category,
      name: doc.name,
      text,
      ok,
      note,
    });
  }

  return results;
}

async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({
    data,
    // Disable worker fetch fallbacks that can break in some sandboxes
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items as any[])
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);
    pages.push(`--- Page ${i} ---\n${strings.join(" ")}`);
  }
  return pages.join("\n\n");
}

async function extractXlsxText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      out.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
  }
  return out.join("\n\n");
}

/**
 * Heuristic: a string is "readable" if it contains a reasonable ratio of
 * printable ASCII characters. Binary blobs read as text are dominated by
 * control bytes and replacement characters.
 */
function looksLikeReadableText(s: string): boolean {
  if (!s || s.length < 20) return false;
  const sample = s.slice(0, 2000);
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) printable++;
  }
  return printable / sample.length > 0.85;
}
