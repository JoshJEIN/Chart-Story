// SN Visit Series — types for the 60-day cert period generator.
import { RedFlag, SourceEntry, AuditFailure, AuditMeta } from "@/types/pcr";
import { SocPlanOfCare } from "@/types/soc";

export interface FrequencyBlock {
  weeksLabel: string;          // raw, e.g. "2w3"
  visitsPerWeek: number;       // 2
  weeks: number;               // 3
  totalVisits: number;         // 6
  discipline?: string;         // SN | PT | OT | ST | MSW | HHA (optional, default SN)
}

export interface FrequencyOrder {
  raw: string;
  parsed: FrequencyBlock[];
  totalVisitsScheduled: number;
}

export interface CertPeriod {
  startDate: string;   // ISO yyyy-mm-dd
  endDate: string;     // ISO (start + 59)
  day60: string;       // ISO (start + 59), explicit alias for clarity
}

export interface SnEducationTopic {
  id: string;
  topic: string;
  linkedDxOrMed: string;
  level: "basic" | "intermediate" | "advanced";
  prerequisiteIds: string[];
  teachBackQuestions: string[];
  teachingScript: string;
}

export interface SnVisitObjective {
  timestamp: string;            // ISO datetime
  bp?: string;                  // "128/76"
  hr?: number;
  rr?: number;
  spo2?: number;
  temp?: number;                // F
  weight?: number;              // lb
  fsbg?: number;                // mg/dL
  painScore?: number;           // 0-10
  edema?: string;               // "1+ bilateral lower ext"
  lungSounds?: string;
  bowelSounds?: string;
  wound?: {
    location: string;
    lengthCm: number;
    widthCm: number;
    depthCm: number;
    tissueType: string;
    drainage: string;
    periwound: string;
  };
  ambulationDistanceFt?: number;
  transferAssist?: string;
}

export interface SnEducationDelivered {
  topicId: string;
  response: string;
  comprehensionPct: number;     // 0..100
  masteryReached: boolean;
}

export interface SnGoalProgress {
  goalRef: string;              // text or index reference
  status: "met" | "progressing" | "no-change" | "regressed";
  evidence: string;
}

export interface SnVisit {
  visitId: string;
  visitNumber: number;
  visitDate: string;            // ISO date
  weekOfEpisode: number;
  pdgmPeriod: 1 | 2;
  visitType: "SN-Assessment" | "SN-Skilled" | "SN-Recert" | "SN-Discharge";
  subjective: string;
  objective: SnVisitObjective;
  assessment: string;
  plannedInterventions: string[];
  educationDelivered: SnEducationDelivered[];
  skilledJustification: string;
  coordinationOfCare?: string;
  goalsProgress: SnGoalProgress[];
  nextVisitFocus: string;
  homeboundRestated: string;     // visit-specific clinical driver
  ggItemsTouched?: string[];     // GG mobility/self-care for HHVBP
  sources: { field: string; sourceDoc: string }[];
  flags: { code: string; severity: "high" | "medium" | "low"; message: string }[];
}

export interface SnEducationLogEntry {
  topicId: string;
  topic: string;
  level: "basic" | "intermediate" | "advanced";
  firstTaught: string | null;
  reinforcedAt: string[];
  masteredAt: string | null;
  advancedToTopicId: string | null;
}

export interface SnEpisodeSummary {
  period: 1 | 2;
  visitsCompleted: number;
  visitsScheduled: number;
  lupaThreshold: number | null;
  lupaRisk: "below" | "at" | "above" | "unknown";
  lupaImpactNote: string;
  progress: "improved" | "stable" | "declined";
  keyInterventions: string[];
  remainingNeeds: string[];
}

export interface SnLongitudinalAuditFailure {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
  offendingVisitIds: string[];
}

export interface SnLongitudinalAudit {
  pass: boolean;
  failures: SnLongitudinalAuditFailure[];
}

export interface SnPreClaimChecklist {
  f2fLinked: boolean;
  ordersOnFile: boolean;
  oasisCongruent: boolean;
  measurableGoalsTied: boolean;
  homeboundJustifiedEachVisit: boolean;
  educationProgressionDocumented: boolean;
  noClonedObjectiveFindings: boolean;
  lupaAddressed: boolean;
  billableDraftReady: boolean;
  notes: string;
}

export interface SnVerbalOrder {
  date: string;            // ISO date verbal order received
  orderingMd: string;      // physician name
  content: string;         // exact wording of the verbal order
}

export interface SnSeriesResult {
  patientIdentifier: string;
  patientFullName: string;
  certPeriod: CertPeriod;
  frequencyOrder: FrequencyOrder;
  expectedFrequencyFromPOC?: string | null;
  verbalOrder?: SnVerbalOrder | null;
  planOfCare: SocPlanOfCare;
  educationTopics: SnEducationTopic[];
  visits: SnVisit[];
  educationLog: SnEducationLogEntry[];
  episodeSummaries: SnEpisodeSummary[];
  longitudinalAudit: SnLongitudinalAudit;
  preClaimChecklist: SnPreClaimChecklist;
  redFlags: RedFlag[];
  sourceTable: SourceEntry[];
  auditPass?: boolean;
  auditFailures?: AuditFailure[];
  auditMeta?: AuditMeta;
  generatedAt: Date;
}
