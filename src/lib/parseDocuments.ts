import { UploadedDocument } from "@/types/pcr";

export async function extractTextFromDocuments(
  documents: UploadedDocument[]
): Promise<{ category: string; name: string; text: string }[]> {
  const results: { category: string; name: string; text: string }[] = [];

  for (const doc of documents) {
    let text = "";
    if (
      doc.file.type === "text/plain" ||
      doc.file.type === "text/csv" ||
      doc.name.endsWith(".txt") ||
      doc.name.endsWith(".csv")
    ) {
      text = await doc.file.text();
    } else {
      // For PDF/DOCX etc., we'll read as text (best-effort) 
      // In production you'd use a parsing service
      try {
        text = await doc.file.text();
      } catch {
        text = `[Binary file: ${doc.name} — content could not be extracted client-side. Upload text-based exports for best results.]`;
      }
    }

    results.push({
      category: doc.category,
      name: doc.name,
      text: text.slice(0, 15000), // cap per-document to fit context
    });
  }

  return results;
}
