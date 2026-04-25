import { supabase } from "@/integrations/supabase/client";
import { SocAnalysisResult } from "@/types/soc";

interface DocumentPayload {
  category: string;
  name: string;
  text: string;
}

interface AnalyzeOptions {
  maxIterations?: number;
}

export async function analyzeAdmissionDocuments(
  docs: DocumentPayload[],
  options: AnalyzeOptions = {}
): Promise<SocAnalysisResult> {
  const PER_DOC_CHAR_CAP = 80_000;
  const TOTAL_DOC_CHAR_CAP = 600_000;
  const MAX_PAYLOAD_BYTES = 9 * 1024 * 1024;

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

  const { data, error } = await supabase.functions.invoke("soc-analyze", {
    body: {
      documents: payload,
      maxIterations: options.maxIterations,
    },
  });

  if (error) throw new Error(error.message || "Admission analysis failed");

  const result = data as SocAnalysisResult & { _auditMeta?: SocAnalysisResult["auditMeta"] };

  return {
    ...result,
    patientIdentifier: result.patientIdentifier || "Unknown_Pt",
    patientFullName: result.patientFullName || "",
    significantPastHealthHistory: result.significantPastHealthHistory || "",
    medicationReconciliation: result.medicationReconciliation || [],
    educationPlan: result.educationPlan || [],
    redFlags: result.redFlags || [],
    sourceTable: result.sourceTable || [],
    auditFailures: result.auditFailures || [],
    auditMeta: result._auditMeta ?? result.auditMeta,
    generatedAt: new Date(),
  };
}
