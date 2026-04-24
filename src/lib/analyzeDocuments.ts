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
  // only needs category/name/text.
  const payload = docs.map((d) => ({
    category: d.category,
    name: d.name,
    text: d.text,
  }));

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
