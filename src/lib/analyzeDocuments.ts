import { supabase } from "@/integrations/supabase/client";
import {
  AnalysisResult,
  RedFlag,
  SourceEntry,
  MedicationChange,
  AuditFailure,
  AuditMeta,
} from "@/types/pcr";

interface DocumentPayload {
  category: string;
  name: string;
  text: string;
}

interface AnalyzeOptions {
  maxIterations?: number;
}

export async function analyzeDocuments(
  docs: DocumentPayload[],
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  // Strip any extractor metadata (ok/note) before sending — the edge function
  // only needs category/name/text. Apply matching size caps to avoid sending
  // a payload the edge function will reject (which surfaces as truncated
  // request bodies / "Unexpected end of JSON input").
  const PER_DOC_CHAR_CAP = 80_000;
  const TOTAL_DOC_CHAR_CAP = 600_000;
  const MAX_PAYLOAD_BYTES = 9 * 1024 * 1024; // mirror server limit

  let runningTotal = 0;
  const payload = docs.map((d) => {
    let text = typeof d.text === "string" ? d.text : "";
    if (text.length > PER_DOC_CHAR_CAP) text = text.slice(0, PER_DOC_CHAR_CAP);
    const remaining = TOTAL_DOC_CHAR_CAP - runningTotal;
    if (remaining <= 0) text = "";
    else if (text.length > remaining) text = text.slice(0, remaining);
    runningTotal += text.length;
    return { category: d.category, name: d.name, text };
  });

  const approxBytes = new Blob([
    JSON.stringify({ documents: payload, maxIterations: options.maxIterations }),
  ]).size;
  if (approxBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Request payload is ~${(approxBytes / 1024 / 1024).toFixed(1)} MB, which exceeds the ${(MAX_PAYLOAD_BYTES / 1024 / 1024).toFixed(0)} MB server limit. Analyze fewer or smaller documents per run.`
    );
  }

  const { data, error } = await supabase.functions.invoke("pcr-analyze", {
    body: {
      documents: payload,
      maxIterations: options.maxIterations,
    },
  });

  if (error) throw new Error(error.message || "Analysis failed");

  const result = data as {
    recertificationAnalysis: string;
    chartStorySummary: string;
    patientSummary: string;
    significantPastHealthHistory?: string;
    redFlags: RedFlag[];
    medicationChanges: MedicationChange[];
    sourceTable: SourceEntry[];
    patientIdentifier?: string;
    episodeRange?: string;
    auditPass?: boolean;
    auditFailures?: AuditFailure[];
    _auditMeta?: AuditMeta;
  };

  return {
    ...result,
    significantPastHealthHistory: result.significantPastHealthHistory || "",
    medicationChanges: result.medicationChanges || [],
    patientIdentifier: result.patientIdentifier || "Unknown_Pt",
    episodeRange: result.episodeRange || "Episode_Unknown",
    auditPass: result.auditPass,
    auditFailures: result.auditFailures || [],
    auditMeta: result._auditMeta,
    generatedAt: new Date(),
  };
}
