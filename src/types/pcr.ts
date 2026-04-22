export interface UploadedDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  file: File;
  content?: string;
  uploadedAt: Date;
}

export type DocumentCategory =
  | "oasis"
  | "plan_of_care"
  | "face_to_face"
  | "physician_order"
  | "sn_visit_notes"
  | "soap_notes"
  | "labs_diagnostics"
  | "medication_list"
  | "other";

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  oasis: "OASIS Assessment",
  plan_of_care: "Plan of Care",
  face_to_face: "Face-to-Face Documentation",
  physician_order: "Physician Order / Certification",
  sn_visit_notes: "SN Visit Notes & Vitals",
  soap_notes: "Specialist / SOAP Notes",
  labs_diagnostics: "Labs / Diagnostics / Imaging",
  medication_list: "Medication List / MAR",
  other: "Other Supporting Documents",
};

export interface MedicationChange {
  medication: string;
  changeType: "new" | "discontinued" | "dose_change" | "frequency_change" | "route_change";
  details: string;
  linkedDiagnosis: string;
  sourceDocument: string;
}

export interface AnalysisResult {
  recertificationAnalysis: string;
  chartStorySummary: string;
  patientSummary: string;
  significantPastHealthHistory: string;
  redFlags: RedFlag[];
  medicationChanges: MedicationChange[];
  sourceTable: SourceEntry[];
  patientIdentifier: string;
  episodeRange: string;
  generatedAt: Date;
}

export interface RedFlag {
  category: string;
  description: string;
  severity: "high" | "medium" | "low";
}

export interface SourceEntry {
  finding: string;
  sourceDocument: string;
  date: string;
  category: string;
}
