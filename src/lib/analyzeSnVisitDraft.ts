import { supabase } from "@/integrations/supabase/client";
import type { SnSingleVisitDraft, SnVisitDraftMode } from "@/types/snVisitDraft";

export interface SnVisitDraftRequest {
  mode: SnVisitDraftMode;
  visitDate: string;
  visitNumber?: number;
  weekOfEpisode?: number;
  patientContext?: string;
  sourceExcerpt?: string;
  teachingFocus?: string;
  patientIdentifier?: string;
  patientFullName?: string;
}

export async function analyzeSnVisitDraft(
  req: SnVisitDraftRequest,
): Promise<SnSingleVisitDraft> {
  const { data, error } = await supabase.functions.invoke("sn-visit-draft", {
    body: req,
  });
  if (error) throw new Error(error.message || "SN visit draft generation failed");
  return data as SnSingleVisitDraft;
}
