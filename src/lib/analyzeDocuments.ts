import { supabase } from "@/integrations/supabase/client";
import { AnalysisResult, RedFlag, SourceEntry, MedicationChange } from "@/types/pcr";

interface DocumentPayload {
  category: string;
  name: string;
  text: string;
}

export async function analyzeDocuments(
  docs: DocumentPayload[]
): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke("pcr-analyze", {
    body: { documents: docs },
  });

  if (error) throw new Error(error.message || "Analysis failed");

  const result = data as {
    recertificationAnalysis: string;
    chartStorySummary: string;
    patientSummary: string;
    redFlags: RedFlag[];
    medicationChanges: MedicationChange[];
    sourceTable: SourceEntry[];
  };

  return {
    ...result,
    medicationChanges: result.medicationChanges || [],
    generatedAt: new Date(),
  };
}
