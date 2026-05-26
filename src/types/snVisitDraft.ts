import type { SnVisit } from "./snSeries";

export type SnVisitDraftMode = "quick" | "recertNarrative";

export interface SnSingleVisitDraft {
  mode: SnVisitDraftMode;
  visit: SnVisit;
  addedFields: string[];
  provenanceNotes: string;
  inputExcerpt: string;
  patientIdentifier?: string;
  patientFullName?: string;
  generatedAt: string;
}
