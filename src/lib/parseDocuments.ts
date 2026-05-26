import { UploadedDocument } from "@/types/pcr";
import { supabase } from "@/integrations/supabase/client";

// PDF.js — use the legacy build for broad browser support and configure the worker
// from the same package so Vite bundles it correctly.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import mammoth from "mammoth";
import * as XLSX from "xlsx";

const MAX_CHARS_PER_DOC = 60_000; // ~15k tokens — large enough for most clinical packets
const OCR_MAX_PAGES = 12;
const OCR_RENDER_SCALE = 2.0; // higher = better OCR, slower
const OCR_JPEG_QUALITY = 0.85;

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
          // Scanned PDF — fall back to OCR via edge function.
          try {
            const ocrText = await ocrPdfViaEdge(doc.file);
            if (ocrText.trim().length > 0) {
              text = ocrText;
              ok = true;
              note = "Scanned PDF — text extracted via OCR.";
            } else {
              note =
                "PDF appears to be a scanned image and OCR returned no text. Try a clearer scan or a typed version.";
            }
          } catch (ocrErr) {
            note = `Scanned PDF; OCR failed: ${ocrErr instanceof Error ? ocrErr.message : String(ocrErr)}`;
          }
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
      } else if (
        mime.startsWith("image/") ||
        /\.(png|jpe?g|webp|heic|bmp|gif)$/i.test(lower)
      ) {
        try {
          text = await ocrImageViaEdge(doc.file);
          ok = text.trim().length > 0;
          if (!ok) note = "OCR returned no text for this image.";
        } catch (ocrErr) {
          note = `Image OCR failed: ${ocrErr instanceof Error ? ocrErr.message : String(ocrErr)}`;
        }
      } else {
        // Unknown — try plain text as last resort, but validate it looks like text
        const raw = await doc.file.text();
        if (looksLikeReadableText(raw)) {
          text = raw;
          ok = text.trim().length > 0;
        } else {
          note = `Unsupported or binary file format (${mime || "unknown"}). Upload PDF, DOCX, XLSX, TXT, CSV, or an image (PNG/JPG).`;
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

// ──────────────────────────── OCR fallback ────────────────────────────

async function ocrPdfViaEdge(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pages: { base64: string; mimeType: string }[] = [];
  const total = Math.min(pdf.numPages, OCR_MAX_PAGES);
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const dataUrl = await renderPdfPageToDataUrl(page);
    const base64 = dataUrl.split(",")[1] || "";
    pages.push({ base64, mimeType: "image/jpeg" });
  }

  return await callOcrEdge(pages);
}

async function renderPdfPageToDataUrl(page: any): Promise<string> {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", OCR_JPEG_QUALITY);
}

async function ocrImageViaEdge(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const base64 = dataUrl.split(",")[1] || "";
  const mimeType = file.type || "image/png";
  return await callOcrEdge([{ base64, mimeType }]);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

async function callOcrEdge(
  pages: { base64: string; mimeType: string }[],
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ocr-document", {
    body: { pages },
  });
  if (error) throw new Error(error.message || "OCR edge function failed");
  const text = (data as any)?.text;
  return typeof text === "string" ? text : "";
}
