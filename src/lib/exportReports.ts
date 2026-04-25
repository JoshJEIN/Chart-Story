import { AnalysisResult } from "@/types/pcr";
import { SocAnalysisResult } from "@/types/soc";

const CHANGE_TYPE_LABELS: Record<string, string> = {
  new: "New",
  discontinued: "Discontinued",
  dose_change: "Dose Change",
  frequency_change: "Frequency Change",
  route_change: "Route Change",
};

export function generateDetailedAnalysisPDF(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();

  lines.push("PCR RECERTIFICATION ANALYSIS — DETAILED REPORT");
  lines.push(`Patient: ${result.patientIdentifier || "Unknown"}`);
  lines.push(`Episode Analyzed: ${result.episodeRange || "Unknown"}`);
  lines.push(`Generated: ${date}`);
  lines.push("=".repeat(70));
  lines.push("");

  // Recertification Analysis
  lines.push("RECERTIFICATION ANALYSIS");
  lines.push("-".repeat(40));
  lines.push(result.recertificationAnalysis);
  lines.push("");

  // Chart Story Summary
  lines.push("CHART STORY SUMMARY");
  lines.push("-".repeat(40));
  lines.push(result.chartStorySummary);
  lines.push("");

  // Red Flags
  lines.push("RED FLAGS & CONCERNS");
  lines.push("-".repeat(40));
  if (result.redFlags.length === 0) {
    lines.push("No red flags identified.");
  } else {
    result.redFlags.forEach((flag, i) => {
      lines.push(`${i + 1}. [${flag.severity.toUpperCase()}] ${flag.category}`);
      lines.push(`   ${flag.description}`);
      lines.push("");
    });
  }
  lines.push("");

  // Medication Changes
  lines.push("MEDICATION CHANGES (Initial → Current)");
  lines.push("-".repeat(40));
  if (!result.medicationChanges || result.medicationChanges.length === 0) {
    lines.push("No medication changes identified.");
  } else {
    result.medicationChanges.forEach((med, i) => {
      lines.push(`${i + 1}. ${med.medication} — ${CHANGE_TYPE_LABELS[med.changeType] || med.changeType}`);
      lines.push(`   Details: ${med.details}`);
      lines.push(`   Linked Dx: ${med.linkedDiagnosis}`);
      lines.push(`   Source: ${med.sourceDocument}`);
      lines.push("");
    });
  }
  lines.push("");

  // Source Table
  lines.push("SOURCE-TO-DOCUMENTATION TABLE");
  lines.push("-".repeat(40));
  lines.push(padRow("Finding", "Source", "Date", "Category"));
  lines.push("-".repeat(70));
  result.sourceTable.forEach((entry) => {
    lines.push(padRow(entry.finding, entry.sourceDocument, entry.date, entry.category));
  });

  downloadTextFile(lines.join("\n"), buildFilename("PCR_Detailed_Analysis", result));
}

export function generatePatientSummaryPDF(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();

  lines.push("PATIENT SUMMARY — PCR RECERTIFICATION");
  lines.push(`Patient: ${result.patientIdentifier || "Unknown"}`);
  lines.push(`Episode Analyzed: ${result.episodeRange || "Unknown"}`);
  lines.push(`Generated: ${date}`);
  lines.push("=".repeat(70));
  lines.push("");

  lines.push("PATIENT SUMMARY");
  lines.push("-".repeat(40));
  lines.push(result.patientSummary);
  lines.push("");

  // Include key red flags as QA notes
  if (result.redFlags.length > 0) {
    lines.push("QA NOTES — FLAGGED ITEMS");
    lines.push("-".repeat(40));
    result.redFlags
      .filter((f) => f.severity === "high" || f.severity === "medium")
      .forEach((flag, i) => {
        lines.push(`${i + 1}. [${flag.severity.toUpperCase()}] ${flag.category}: ${flag.description}`);
      });
    lines.push("");
  }

  // Key medication changes
  if (result.medicationChanges && result.medicationChanges.length > 0) {
    lines.push("KEY MEDICATION CHANGES");
    lines.push("-".repeat(40));
    result.medicationChanges.forEach((med) => {
      lines.push(`• ${med.medication} (${CHANGE_TYPE_LABELS[med.changeType] || med.changeType}): ${med.details} — Dx: ${med.linkedDiagnosis}`);
    });
    lines.push("");
  }

  downloadTextFile(lines.join("\n"), buildFilename("PCR_Patient_Summary", result));
}

export function generateSignificantPastHealthHistoryPDF(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();
  const MAJOR = "=".repeat(70);
  const MINOR = "-".repeat(70);

  // Header with decorative separators
  lines.push(MAJOR);
  lines.push("SIGNIFICANT PAST HEALTH HISTORY — OASIS RECERTIFICATION");
  lines.push(MAJOR);
  lines.push(`Patient: ${result.patientIdentifier || "Unknown"}`);
  lines.push(`Episode Analyzed: ${result.episodeRange || "Unknown"}`);
  lines.push(`Generated: ${date}`);
  lines.push(MAJOR);
  lines.push("");

  // Significant Past Health History narrative
  lines.push("SIGNIFICANT PAST HEALTH HISTORY");
  lines.push(MINOR);
  const body =
    result.significantPastHealthHistory ||
    "No significant past health history was generated. Please re-run analysis.";
  lines.push(stripBullets(body));
  lines.push("");

  // Patient Summary
  lines.push(MAJOR);
  lines.push("PATIENT SUMMARY");
  lines.push(MINOR);
  lines.push(stripBullets(result.patientSummary || "(none)"));
  lines.push("");

  // Chart Story
  lines.push(MAJOR);
  lines.push("CHART STORY SUMMARY");
  lines.push(MINOR);
  lines.push(stripBullets(result.chartStorySummary || "(none)"));
  lines.push("");

  // Source-to-Documentation Table (tabular — no bullet markers)
  lines.push(MAJOR);
  lines.push("SOURCE-TO-DOCUMENTATION TABLE");
  lines.push(MINOR);
  lines.push(padRow("Finding", "Source", "Date", "Category"));
  lines.push(MINOR);
  if (!result.sourceTable || result.sourceTable.length === 0) {
    lines.push("No source entries available.");
  } else {
    result.sourceTable.forEach((entry) => {
      lines.push(
        padRow(
          stripBullets(entry.finding || ""),
          stripBullets(entry.sourceDocument || ""),
          entry.date || "",
          entry.category || ""
        )
      );
    });
  }
  lines.push("");

  // Brief audit notes (compact prose, no bulleted lists)
  const failures = result.auditMeta?.remainingFailures ?? result.auditFailures ?? [];
  const auditPass = result.auditMeta?.finalAuditPass ?? result.auditPass;
  const iterations = result.auditMeta
    ? `${result.auditMeta.iterations} of ${result.auditMeta.maxIterations}`
    : "n/a";

  lines.push(MAJOR);
  lines.push("AUDIT NOTES");
  lines.push(MINOR);
  lines.push(
    `Audit pass: ${auditPass === true ? "PASS" : auditPass === false ? "FAIL" : "n/a"}. ` +
      `Iterations used: ${iterations}. ` +
      (failures.length === 0
        ? "All STEP 6 criteria satisfied (source-traceable claims, dated progression language, HIPAA-safe identifiers, 4-paragraph structure, clinical-consequence enforcement)."
        : `Outstanding items: ${failures
            .map((f) => `(${f.criterion}) ${f.reason}`)
            .join("; ")}.`)
  );
  lines.push(MAJOR);

  downloadTextFile(
    lines.join("\n"),
    buildFilename("PCR_Significant_Past_Health_History", result)
  );
}

// Removes bullet/list markers (•, -, *, +, numeric "1.") from line starts so
// the final document reads as continuous clinical prose.
function stripBullets(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, ""))
    .join("\n");
}

export function generateAuditQAJSON(result: AnalysisResult): void {
  const payload = {
    patientIdentifier: result.patientIdentifier,
    episodeRange: result.episodeRange,
    generatedAt: result.generatedAt.toISOString(),
    auditPass: result.auditPass ?? null,
    auditFailures: result.auditFailures ?? [],
    auditMeta: result.auditMeta ?? null,
    revisedDraft: {
      significantPastHealthHistory: result.significantPastHealthHistory,
      patientSummary: result.patientSummary,
      chartStorySummary: result.chartStorySummary,
      recertificationAnalysis: result.recertificationAnalysis,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFilename("PCR_Audit_QA", result).replace(/\.txt$/, ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateAuditQAReport(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();

  lines.push("PCR AUDIT QA REPORT");
  lines.push(`Patient: ${result.patientIdentifier || "Unknown"}`);
  lines.push(`Episode Analyzed: ${result.episodeRange || "Unknown"}`);
  lines.push(`Generated: ${date}`);
  lines.push("=".repeat(70));
  lines.push("");

  lines.push("AUDIT SUMMARY");
  lines.push("-".repeat(40));
  lines.push(`auditPass: ${result.auditPass ?? "n/a"}`);
  if (result.auditMeta) {
    lines.push(`Iterations used: ${result.auditMeta.iterations} of ${result.auditMeta.maxIterations}`);
    lines.push(`Final audit pass: ${result.auditMeta.finalAuditPass}`);
  }
  lines.push("");

  lines.push("REMAINING AUDIT FAILURES");
  lines.push("-".repeat(40));
  const failures = result.auditMeta?.remainingFailures ?? result.auditFailures ?? [];
  if (failures.length === 0) {
    lines.push("None — all STEP 6 criteria passed.");
  } else {
    failures.forEach((f, i) => {
      lines.push(`${i + 1}. (${f.criterion}) ${f.reason}`);
    });
  }
  lines.push("");

  lines.push("REVISED DRAFT — SIGNIFICANT PAST HEALTH HISTORY");
  lines.push("-".repeat(40));
  lines.push(result.significantPastHealthHistory || "(none)");
  lines.push("");

  lines.push("REVISED DRAFT — PATIENT SUMMARY");
  lines.push("-".repeat(40));
  lines.push(result.patientSummary || "(none)");
  lines.push("");

  downloadTextFile(lines.join("\n"), buildFilename("PCR_Audit_QA_Report", result));
}

function padRow(a: string, b: string, c: string, d: string): string {
  return `${a.substring(0, 30).padEnd(32)}${b.substring(0, 20).padEnd(22)}${c.padEnd(14)}${d}`;
}

function formatFileDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sanitizeForFilename(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Unknown";
}

function buildFilename(prefix: string, result: AnalysisResult): string {
  const pt = sanitizeForFilename(result.patientIdentifier || "Unknown_Pt");
  const ep = sanitizeForFilename(result.episodeRange || "Episode_Unknown");
  const gen = formatFileDate(result.generatedAt);
  return `${prefix}_${pt}_${ep}_generated_${gen}.txt`;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =====================================================================
// START-OF-CARE (ADMISSION) EXPORTERS
// =====================================================================

const SOC_MAJOR = "=".repeat(70);
const SOC_MINOR = "-".repeat(70);

function buildSocFilename(prefix: string, result: SocAnalysisResult): string {
  const pt = sanitizeForFilename(result.patientFullName || result.patientIdentifier || "Unknown_Pt");
  const ep = sanitizeForFilename(result.episodeInfo?.episodeLabel || "Episode_SOC");
  const gen = formatFileDate(result.generatedAt);
  return `${prefix}_${pt}_${ep}_generated_${gen}.txt`;
}

function socHeader(title: string, result: SocAnalysisResult): string[] {
  return [
    SOC_MAJOR,
    title,
    SOC_MAJOR,
    `Patient: ${result.patientIdentifier || "Unknown"}`,
    `Episode: ${result.episodeInfo?.episodeLabel || "—"}`,
    `Cert Period: ${result.episodeInfo?.certPeriodDates || "—"}`,
    `Generated: ${result.generatedAt.toLocaleDateString()}`,
    SOC_MAJOR,
    "",
  ];
}

export function generateSocAdmissionChartStory(result: SocAnalysisResult): void {
  const lines = socHeader("ADMISSION CHART STORY & SIGNIFICANT PMHx", result);
  lines.push("ADMISSION CHART STORY");
  lines.push(SOC_MINOR);
  lines.push(stripBullets(result.admissionChartStory || "(none)"));
  lines.push("");
  lines.push(SOC_MAJOR);
  lines.push("SIGNIFICANT PAST HEALTH HISTORY");
  lines.push(SOC_MINOR);
  lines.push(stripBullets(result.significantPastHealthHistory || "(none)"));
  lines.push("");
  lines.push(SOC_MAJOR);
  lines.push("SOURCE-TO-DOCUMENTATION TABLE");
  lines.push(SOC_MINOR);
  lines.push(padRow("Finding", "Source", "Date", "Category"));
  lines.push(SOC_MINOR);
  (result.sourceTable || []).forEach((e) => {
    lines.push(padRow(stripBullets(e.finding || ""), stripBullets(e.sourceDocument || ""), e.date || "", e.category || ""));
  });
  downloadTextFile(lines.join("\n"), buildSocFilename("SOC_Admission_Chart_Story", result));
}

export function generateSocPlanOfCareReport(result: SocAnalysisResult): void {
  const poc = result.planOfCare;
  const lines = socHeader("PLAN OF CARE — 485-ALIGNED (ADMISSION)", result);
  lines.push("PRIMARY DIAGNOSIS");
  lines.push(SOC_MINOR);
  lines.push(poc?.primaryDx || "(none)");
  lines.push("");
  lines.push("SECONDARY DIAGNOSES");
  lines.push(SOC_MINOR);
  (poc?.secondaryDx || []).forEach((d) => lines.push(`• ${d}`));
  if (!poc?.secondaryDx?.length) lines.push("(none documented)");
  lines.push("");
  lines.push("HOMEBOUND JUSTIFICATION");
  lines.push(SOC_MINOR);
  lines.push(poc?.homeboundJustification || "(none)");
  lines.push("");
  lines.push("SKILLED NEED RATIONALE");
  lines.push(SOC_MINOR);
  lines.push(poc?.skilledNeedRationale || "(none)");
  lines.push("");
  lines.push("MEASURABLE GOALS (timed)");
  lines.push(SOC_MINOR);
  (poc?.measurableGoals || []).forEach((g, i) => lines.push(`${i + 1}. ${g}`));
  lines.push("");
  lines.push("DISCIPLINE ORDERS");
  lines.push(SOC_MINOR);
  (poc?.disciplineOrders || []).forEach((d) => {
    lines.push(`${d.discipline} — ${d.frequencyDuration}`);
    lines.push(`  Interventions: ${d.interventions}`);
    lines.push("");
  });
  lines.push("DME / SUPPLIES");
  lines.push(SOC_MINOR);
  lines.push(poc?.dmeSupplies || "(none)");
  lines.push("");
  lines.push("DISCHARGE PLANNING");
  lines.push(SOC_MINOR);
  lines.push(poc?.dischargePlanning || "(none)");
  lines.push("");
  if (result.medicationReconciliation?.length) {
    lines.push("MEDICATION RECONCILIATION FLAGS");
    lines.push(SOC_MINOR);
    result.medicationReconciliation.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.medication}`);
      lines.push(`   Issue: ${m.issue}`);
      lines.push(`   Recommendation: ${m.recommendation}`);
      lines.push(`   Source: ${m.sourceDocument}`);
      lines.push("");
    });
  }
  downloadTextFile(lines.join("\n"), buildSocFilename("SOC_Plan_of_Care", result));
}

export function generateSocFirstVisitNote(result: SocAnalysisResult): void {
  const v = result.firstSnVisitNote;
  const lines = socHeader("FIRST SN VISIT NOTE — TEMPLATE (clinician to edit & sign)", result);
  lines.push("SUBJECTIVE");
  lines.push(SOC_MINOR);
  lines.push(v?.subjective || "(none)");
  lines.push("");
  lines.push("OBJECTIVE — assessment focus");
  lines.push(SOC_MINOR);
  (v?.objectiveFocus || []).forEach((x) => lines.push(`• ${x}`));
  lines.push("");
  lines.push("ASSESSMENT");
  lines.push(SOC_MINOR);
  lines.push(v?.assessment || "(none)");
  lines.push("");
  lines.push("PLAN — interventions");
  lines.push(SOC_MINOR);
  (v?.plannedInterventions || []).forEach((x) => lines.push(`• ${x}`));
  lines.push("");
  lines.push("TEACHING TOPICS (Visit 1 priorities)");
  lines.push(SOC_MINOR);
  (v?.teachingTopics || []).forEach((x) => lines.push(`• ${x}`));
  lines.push("");
  lines.push("SAFETY CHECKS");
  lines.push(SOC_MINOR);
  (v?.safetyChecks || []).forEach((x) => lines.push(`• ${x}`));
  lines.push("");
  lines.push("SKILLED JUSTIFICATION");
  lines.push(SOC_MINOR);
  lines.push(v?.skilledJustification || "(none)");
  downloadTextFile(lines.join("\n"), buildSocFilename("SOC_First_SN_Visit_Note", result));
}

export function generateSocEducationPlan(result: SocAnalysisResult): void {
  const lines = socHeader("PATIENT / CAREGIVER EDUCATION PLAN", result);
  if (!result.educationPlan?.length) {
    lines.push("(no education topics generated)");
    downloadTextFile(lines.join("\n"), buildSocFilename("SOC_Education_Plan", result));
    return;
  }
  result.educationPlan.forEach((e, i) => {
    lines.push(`TOPIC ${i + 1}: ${e.topic}`);
    lines.push(SOC_MINOR);
    lines.push(`Linked to: ${e.linkedDiagnosisOrMed}`);
    lines.push("");
    lines.push("Why it matters:");
    lines.push(e.whyItMatters || "");
    lines.push("");
    lines.push("Full explanation (chart-ready teaching narrative):");
    lines.push(e.fullExplanation || "");
    lines.push("");
    if (e.signsToWatch?.length) {
      lines.push("Signs to watch for:");
      e.signsToWatch.forEach((s) => lines.push(`  • ${s}`));
      lines.push("");
    }
    if (e.dietaryGuidance) {
      lines.push("Dietary guidance:");
      lines.push(e.dietaryGuidance);
      lines.push("");
    }
    if (e.medGuidance) {
      lines.push("Medication guidance:");
      lines.push(e.medGuidance);
      lines.push("");
    }
    if (e.teachBackQuestions?.length) {
      lines.push("Teach-back questions:");
      e.teachBackQuestions.forEach((q, j) => lines.push(`  ${j + 1}. ${q}`));
      lines.push("");
    }
    lines.push(SOC_MAJOR);
    lines.push("");
  });
  downloadTextFile(lines.join("\n"), buildSocFilename("SOC_Education_Plan", result));
}

export function generateSocAuditQAJSON(result: SocAnalysisResult): void {
  const payload = {
    patientIdentifier: result.patientIdentifier,
    episodeInfo: result.episodeInfo,
    generatedAt: result.generatedAt.toISOString(),
    auditPass: result.auditPass ?? null,
    auditFailures: result.auditFailures ?? [],
    auditMeta: result.auditMeta ?? null,
    revisedDraft: {
      admissionChartStory: result.admissionChartStory,
      significantPastHealthHistory: result.significantPastHealthHistory,
      planOfCare: result.planOfCare,
      firstSnVisitNote: result.firstSnVisitNote,
      educationPlan: result.educationPlan,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildSocFilename("SOC_Audit_QA", result).replace(/\.txt$/, ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
