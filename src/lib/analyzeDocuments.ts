import { supabase } from "@/integrations/supabase/client";
import { AnalysisResult, RedFlag, SourceEntry } from "@/types/pcr";

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

  // Parse the tool call response
  const result = data as {
    recertificationAnalysis: string;
    chartStorySummary: string;
    redFlags: RedFlag[];
    sourceTable: SourceEntry[];
  };

  return {
    ...result,
    generatedAt: new Date(),
  };
}
