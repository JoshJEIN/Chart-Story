import { RedFlag, SourceEntry, AuditFailure, AuditMeta } from "@/types/pcr";

export interface SocEpisodeInfo {
  episodeType: string;
  certPeriodDates: string;
  episodeLabel: string;
}

export interface SocDisciplineOrder {
  discipline: string;
  frequencyDuration: string;
  interventions: string;
}

export interface SocPlanOfCare {
  primaryDx: string;
  secondaryDx: string[];
  homeboundJustification: string;
  skilledNeedRationale: string;
  measurableGoals: string[];
  disciplineOrders: SocDisciplineOrder[];
  dmeSupplies: string;
}

export interface SocFirstVisitNote {
  subjective: string;
  objectiveFocus: string[];
  assessment: string;
  plannedInterventions: string[];
  teachingTopics: string[];
  safetyChecks: string[];
  skilledJustification: string;
}

export interface SocEducationTopic {
  topic: string;
  linkedDiagnosisOrMed: string;
  whyItMatters: string;
  fullExplanation: string;
  signsToWatch: string[];
  dietaryGuidance: string;
  medGuidance: string;
  teachBackQuestions: string[];
}

export interface SocMedicationReconciliation {
  medication: string;
  issue: string;
  recommendation: string;
  sourceDocument: string;
}

export interface SocAnalysisResult {
  patientIdentifier: string;
  patientFullName: string;
  episodeInfo: SocEpisodeInfo;
  admissionChartStory: string;
  significantPastHealthHistory: string;
  planOfCare: SocPlanOfCare;
  firstSnVisitNote: SocFirstVisitNote;
  educationPlan: SocEducationTopic[];
  redFlags: RedFlag[];
  medicationReconciliation: SocMedicationReconciliation[];
  sourceTable: SourceEntry[];
  auditPass?: boolean;
  auditFailures?: AuditFailure[];
  auditMeta?: AuditMeta;
  generatedAt: Date;
}
