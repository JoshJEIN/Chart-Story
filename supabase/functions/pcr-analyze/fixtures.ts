// Test fixtures for the pcr-analyze audit retry loop.
// Each fixture is a scripted sequence of AI gateway responses that the stub
// server will replay in order. Each response represents one audit iteration.
//
// The fields mirror the OpenAI-compatible chat-completions tool-call shape
// the edge function expects.

export interface ScriptedAnalysis {
  recertificationAnalysis: string;
  chartStorySummary: string;
  patientSummary: string;
  significantPastHealthHistory: string;
  redFlags: Array<{ category: string; description: string; severity: string }>;
  medicationChanges: Array<{
    medication: string;
    changeType: string;
    details: string;
    linkedDiagnosis: string;
    sourceDocument: string;
  }>;
  sourceTable: Array<{
    finding: string;
    sourceDocument: string;
    date: string;
    category: string;
  }>;
  patientIdentifier: string;
  episodeRange: string;
  auditPass: boolean;
  auditFailures: Array<{ criterion: string; reason: string }>;
}

export interface AuditFixture {
  name: string;
  description: string;
  // Sequence of scripted analyses, one per audit iteration.
  scriptedResponses: ScriptedAnalysis[];
  // Expected final state after the edge function finishes.
  expected: {
    finalAuditPass: boolean;
    iterationsRun: number;
    remainingFailureCount: number;
  };
}

const baseAnalysis: ScriptedAnalysis = {
  recertificationAnalysis:
    "Pt with CHF (worsened — EF 45% on 2026-01-10 → 35% on 2026-04-12) and DM2 (unstable — A1c 7.1% on 2026-01-10 → 9.4% on 2026-04-15). Skilled need: medication titration, observation & assessment for decompensation.",
  chartStorySummary:
    "Across the episode the Pt demonstrated worsening cardiac function (EF decline) and worsening glycemic control (A1c rise). Furosemide increased on 2026-04-16 from 20 mg to 40 mg daily for worsening LE edema. Insulin glargine increased on 2026-04-18 from 20 u to 30 u nightly for hyperglycemia.",
  patientSummary:
    "Pt is a homebound adult with CHF (worsened) and DM2 (unstable). Recent dose changes drive continued skilled need.",
  significantPastHealthHistory:
    "PARAGRAPH 1 — CORE DIAGNOSES & MAJOR HISTORY: Pt has CHF (onset 2018), DM2 (onset 2010), HTN, HLD, CKD stage 3 (onset 2022). Chart anchors a chronically multi-morbid older adult with cardiorenal-metabolic burden.\n\nPARAGRAPH 2 — COMORBIDITIES: Cardiorenal cluster (CHF + CKD + HTN) compounds fluid/BP instability. Metabolic cluster (DM2 + HLD) drives vascular risk.\n\nPARAGRAPH 3 — CLINICAL COURSE & CHANGES SINCE LAST OASIS: Baseline = SOC 2026-01-10. CHF worsened: EF 45% on 2026-01-10 → 35% on 2026-04-12; furosemide increased 20 mg → 40 mg daily on 2026-04-16. DM2 unstable: A1c 7.1% on 2026-01-10 → 9.4% on 2026-04-15; insulin glargine increased 20 u → 30 u nightly on 2026-04-18. Risk: decompensation and hospitalization.\n\nPARAGRAPH 4 — FUNCTIONAL IMPACT & SKILLED NEED DRIVERS: CHF exacerbation → exertional dyspnea at <10 ft → ambulation limited to bedroom-to-bathroom with rolling walker. Homebound: taxing effort + dyspnea. Skilled need: medication titration/teaching, O&A for decompensation, glucose management.",
  redFlags: [],
  medicationChanges: [
    {
      medication: "Furosemide",
      changeType: "dose_change",
      details: "Increased 20 mg → 40 mg daily on 2026-04-16",
      linkedDiagnosis: "CHF",
      sourceDocument: "Physician Order 2026-04-16",
    },
  ],
  sourceTable: [
    {
      finding: "EF decline",
      sourceDocument: "Echo report",
      date: "2026-04-12",
      category: "labs_diagnostics",
    },
  ],
  patientIdentifier: "JD",
  episodeRange: "2026-04-01_to_2026-05-30",
  auditPass: true,
  auditFailures: [],
};

const failingDraft: ScriptedAnalysis = {
  ...baseAnalysis,
  significantPastHealthHistory:
    "Pt presents with CHF and diabetes. Overall clinical status reflects multiple comorbidities. Management is complicated by prior history.",
  auditPass: false,
  auditFailures: [
    { criterion: "e", reason: "Banned opener phrases used (Pt presents with…, Overall clinical status reflects…)." },
    { criterion: "i", reason: "significantPastHealthHistory does not contain the 4 mandated paragraphs." },
    { criterion: "b", reason: "Progression language is missing dated before/after for CHF and DM2." },
  ],
};

export const FIXTURES: Record<string, AuditFixture> = {
  // Passes on the very first iteration — loop should exit immediately.
  passFirstTry: {
    name: "passFirstTry",
    description: "AI returns a fully compliant draft on iteration 1.",
    scriptedResponses: [baseAnalysis],
    expected: {
      finalAuditPass: true,
      iterationsRun: 1,
      remainingFailureCount: 0,
    },
  },

  // Fails twice then passes on iteration 3 — loop should retry and succeed.
  passAfterRetries: {
    name: "passAfterRetries",
    description: "Two failing drafts then a passing one — verifies retry loop.",
    scriptedResponses: [failingDraft, failingDraft, baseAnalysis],
    expected: {
      finalAuditPass: true,
      iterationsRun: 3,
      remainingFailureCount: 0,
    },
  },

  // Always fails — loop should hit max iterations and surface remaining failures.
  alwaysFails: {
    name: "alwaysFails",
    description:
      "AI never returns auditPass=true — loop must stop at MAX_AUDIT_ITERATIONS and report failures.",
    scriptedResponses: [failingDraft, failingDraft, failingDraft, failingDraft, failingDraft],
    expected: {
      finalAuditPass: false,
      iterationsRun: 3, // default max
      remainingFailureCount: 3,
    },
  },
};
