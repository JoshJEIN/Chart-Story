import { AnalysisResult } from "@/types/pcr";
import { SocAnalysisResult } from "@/types/soc";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

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
  const fullName = (result as any).patientFullName || "(name not documented)";

  lines.push("CStoryApp — PCR RECERTIFICATION ANALYSIS — DETAILED REPORT");
  lines.push(`Patient: ${fullName}`);
  lines.push(`Patient ID: ${result.patientIdentifier || "Unknown"}`);
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
  const fullName = (result as any).patientFullName || "(name not documented)";

  lines.push("CStoryApp — PATIENT SUMMARY — PCR RECERTIFICATION");
  lines.push(`Patient: ${fullName}`);
  lines.push(`Patient ID: ${result.patientIdentifier || "Unknown"}`);
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
  const fullName = (result as any).patientFullName || "(name not documented)";
  const MAJOR = "=".repeat(70);
  const MINOR = "-".repeat(70);

  // Header with decorative separators
  lines.push(MAJOR);
  lines.push("CStoryApp — SIGNIFICANT PAST HEALTH HISTORY — OASIS RECERTIFICATION");
  lines.push(`Patient: ${fullName}`);
  lines.push(MAJOR);
  lines.push(`Patient ID: ${result.patientIdentifier || "Unknown"}`);
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
  a.download = buildFilename("PCR_Audit_QA", result).replace(/\.docx$/, ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateAuditQAReport(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();
  const fullName = (result as any).patientFullName || "(name not documented)";

  lines.push("CStoryApp — PCR AUDIT QA REPORT");
  lines.push(`Patient: ${fullName}`);
  lines.push(`Patient ID: ${result.patientIdentifier || "Unknown"}`);
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

// App-wide filename prefix that appears on every downloadable deliverable.
const APP_TAG = "CStoryApp";

function buildFilename(prefix: string, result: AnalysisResult): string {
  const name = sanitizeForFilename(
    (result as any).patientFullName || result.patientIdentifier || "Unknown_Pt",
  );
  const ep = sanitizeForFilename(result.episodeRange || "Episode_Unknown");
  const gen = formatFileDate(result.generatedAt);
  return `${APP_TAG}_${prefix}_${name}_${ep}_generated_${gen}.docx`;
}

// Convert plain-text "report" lines into a real .docx. Lines that look like
// section banners (ALL CAPS or '=== / ---' rules) become headings/separators
// so the doc reads naturally in Word/Google Docs.
function downloadTextFile(content: string, filename: string) {
  const rawLines = content.split("\n");
  const paragraphs: Paragraph[] = rawLines.map((line) => {
    if (/^[=]{5,}$/.test(line) || /^[-]{5,}$/.test(line)) {
      return new Paragraph({ children: [new TextRun({ text: "" })] });
    }
    const trimmed = line.trim();
    // Title line (first one with CStoryApp tag) → Heading 1
    if (/^CStoryApp\s+[—-]/.test(trimmed)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: trimmed, bold: true })],
      });
    }
    // Section header heuristic: ALL CAPS line, no lowercase, short-ish
    if (
      trimmed.length > 0 &&
      trimmed.length < 90 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !/^\d/.test(trimmed)
    ) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: trimmed, bold: true })],
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: line, font: "Calibri", size: 22 })],
    });
  });

  const doc = new Document({
    creator: "CStoryApp",
    title: filename,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{ children: paragraphs }],
  });

  Packer.toBlob(doc).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// =====================================================================
// START-OF-CARE (ADMISSION) EXPORTERS
// =====================================================================

const SOC_MAJOR = "=".repeat(70);
const SOC_MINOR = "-".repeat(70);

function buildSocFilename(prefix: string, result: SocAnalysisResult): string {
  const name = sanitizeForFilename(
    result.patientFullName || result.patientIdentifier || "Unknown_Pt",
  );
  const ep = sanitizeForFilename(result.episodeInfo?.episodeLabel || "Episode_SOC");
  const gen = formatFileDate(result.generatedAt);
  return `${APP_TAG}_${prefix}_${name}_${ep}_generated_${gen}.docx`;
}

function socHeader(title: string, result: SocAnalysisResult): string[] {
  const fullName = result.patientFullName || "(name not documented)";
  return [
    SOC_MAJOR,
    `${APP_TAG} — ${title}`,
    `Patient: ${fullName}`,
    SOC_MAJOR,
    `Patient ID: ${result.patientIdentifier || "Unknown"}`,
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
  a.download = buildSocFilename("SOC_Audit_QA", result).replace(/\.docx$/, ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =====================================================================
// SN VISIT SERIES EXPORTERS
// =====================================================================

import type { SnSeriesResult } from "@/types/snSeries";

const SN_MAJOR = "=".repeat(70);
const SN_MINOR = "-".repeat(70);

function buildSnFilename(prefix: string, result: SnSeriesResult, ext = "txt"): string {
  const name = sanitizeForFilename(
    result.patientFullName || result.patientIdentifier || "Unknown_Pt",
  );
  const start = result.certPeriod?.startDate ?? "unknown_start";
  const gen = formatFileDate(result.generatedAt);
  return `${APP_TAG}_${prefix}_${name}_cert_${start}_generated_${gen}.${ext}`;
}

function snHeader(title: string, result: SnSeriesResult): string[] {
  const fullName = result.patientFullName || "(name not documented)";
  return [
    SN_MAJOR,
    `${APP_TAG} — ${title}`,
    `Patient: ${fullName}`,
    SN_MAJOR,
    `Patient ID: ${result.patientIdentifier || "Unknown"}`,
    `Cert Period: ${result.certPeriod?.startDate ?? "—"} → ${result.certPeriod?.endDate ?? "—"} (60 days)`,
    `Frequency Order: ${result.frequencyOrder?.raw ?? "—"} (${result.frequencyOrder?.totalVisitsScheduled ?? 0} SN visits)`,
    `Generated: ${result.generatedAt.toLocaleDateString()}`,
    SN_MAJOR,
    "",
  ];
}

export function generateSnSeriesBundle(result: SnSeriesResult): void {
  const lines = snHeader("SN VISIT SERIES — FULL CERT-PERIOD BUNDLE", result);

  // Plan of Care
  lines.push("PLAN OF CARE (485-aligned, no discharge planning)");
  lines.push(SN_MINOR);
  lines.push(`Primary Dx: ${result.planOfCare?.primaryDx ?? "(none)"}`);
  if (result.planOfCare?.secondaryDx?.length) {
    lines.push(`Secondary Dx:`);
    result.planOfCare.secondaryDx.forEach((d) => lines.push(`  • ${d}`));
  }
  lines.push("");
  lines.push("Homebound Justification:");
  lines.push(result.planOfCare?.homeboundJustification ?? "(none)");
  lines.push("");
  lines.push("Skilled Need Rationale:");
  lines.push(result.planOfCare?.skilledNeedRationale ?? "(none)");
  lines.push("");
  lines.push("Measurable Goals (timed):");
  (result.planOfCare?.measurableGoals ?? []).forEach((g, i) => lines.push(`  ${i + 1}. ${g}`));
  lines.push("");
  lines.push("Discipline Orders:");
  (result.planOfCare?.disciplineOrders ?? []).forEach((d) => {
    lines.push(`  ${d.discipline} — ${d.frequencyDuration}`);
    lines.push(`    ${d.interventions}`);
  });
  lines.push("");
  lines.push(`DME / Supplies: ${result.planOfCare?.dmeSupplies ?? "(none)"}`);
  lines.push("");

  // Episode summaries
  lines.push(SN_MAJOR);
  lines.push("PDGM 30-DAY PERIOD SUMMARIES");
  lines.push(SN_MINOR);
  (result.episodeSummaries ?? []).forEach((ep) => {
    lines.push(
      `Period ${ep.period}: ${ep.visitsCompleted}/${ep.visitsScheduled} visits · LUPA ${ep.lupaRisk}` +
      (ep.lupaThreshold != null ? ` (threshold ${ep.lupaThreshold})` : ""),
    );
    lines.push(`  ${ep.lupaImpactNote}`);
    lines.push(`  Progress: ${ep.progress}`);
    if (ep.keyInterventions?.length) lines.push(`  Key interventions: ${ep.keyInterventions.join("; ")}`);
    if (ep.remainingNeeds?.length) lines.push(`  Remaining needs: ${ep.remainingNeeds.join("; ")}`);
    lines.push("");
  });

  // Visits
  lines.push(SN_MAJOR);
  lines.push("VISIT NOTES");
  lines.push(SN_MAJOR);
  (result.visits ?? []).forEach((v) => {
    lines.push("");
    lines.push(`VISIT #${v.visitNumber} — ${v.visitDate} — wk${v.weekOfEpisode} P${v.pdgmPeriod} — ${v.visitType}`);
    lines.push(SN_MINOR);
    lines.push(`Subjective: ${v.subjective}`);
    lines.push(`Objective (${v.objective?.timestamp}):`);
    const o = v.objective ?? ({} as any);
    const vitals: string[] = [];
    if (o.bp) vitals.push(`BP ${o.bp}`);
    if (o.hr != null) vitals.push(`HR ${o.hr}`);
    if (o.rr != null) vitals.push(`RR ${o.rr}`);
    if (o.spo2 != null) vitals.push(`SpO2 ${o.spo2}%`);
    if (o.temp != null) vitals.push(`T ${o.temp}°F`);
    if (o.weight != null) vitals.push(`Wt ${o.weight}lb`);
    if (o.fsbg != null) vitals.push(`FSBG ${o.fsbg}`);
    if (o.painScore != null) vitals.push(`Pain ${o.painScore}/10`);
    lines.push(`  ${vitals.join(" · ")}`);
    if (o.lungSounds) lines.push(`  Lungs: ${o.lungSounds}`);
    if (o.edema) lines.push(`  Edema: ${o.edema}`);
    if (o.wound) {
      lines.push(`  Wound (${o.wound.location}): ${o.wound.lengthCm}×${o.wound.widthCm}×${o.wound.depthCm}cm, ${o.wound.tissueType}, ${o.wound.drainage}, periwound ${o.wound.periwound}`);
    }
    if (o.ambulationDistanceFt != null) lines.push(`  Ambulation: ${o.ambulationDistanceFt} ft (${o.transferAssist ?? "n/a"})`);
    lines.push(`Assessment: ${v.assessment}`);
    lines.push(`Planned Interventions:`);
    (v.plannedInterventions ?? []).forEach((p) => lines.push(`  • ${p}`));
    lines.push(`Skilled Justification: ${v.skilledJustification}`);
    lines.push(`Homebound (this visit): ${v.homeboundRestated}`);
    if (v.educationDelivered?.length) {
      lines.push(`Education delivered:`);
      v.educationDelivered.forEach((e) => {
        const t = result.educationTopics?.find((tt) => tt.id === e.topicId);
        lines.push(`  • ${t?.topic ?? e.topicId} — ${e.comprehensionPct}%${e.masteryReached ? " (mastered)" : ""}`);
        lines.push(`    ${e.response}`);
      });
    }
    if (v.goalsProgress?.length) {
      lines.push(`Goals progress:`);
      v.goalsProgress.forEach((g) => lines.push(`  • [${g.status}] ${g.goalRef} — ${g.evidence}`));
    }
    if (v.coordinationOfCare) lines.push(`Coordination: ${v.coordinationOfCare}`);
    lines.push(`Next visit focus: ${v.nextVisitFocus}`);
    if (v.ggItemsTouched?.length) lines.push(`GG items: ${v.ggItemsTouched.join(", ")}`);
    if (v.sources?.length) {
      lines.push(`Sources:`);
      v.sources.forEach((s) => lines.push(`  ${s.field} ← ${s.sourceDoc}`));
    }
    if (v.flags?.length) {
      lines.push(`FLAGS:`);
      v.flags.forEach((f) => lines.push(`  [${f.code}/${f.severity}] ${f.message}`));
    }
  });

  // Audit
  lines.push("");
  lines.push(SN_MAJOR);
  lines.push("LONGITUDINAL AUDIT");
  lines.push(SN_MINOR);
  lines.push(`Pass: ${result.longitudinalAudit?.pass ? "YES" : "NO"}`);
  (result.longitudinalAudit?.failures ?? []).forEach((f, i) => {
    lines.push(`  ${i + 1}. [${f.code}/${f.severity}] ${f.message} — visits ${f.offendingVisitIds?.join(", ")}`);
  });

  downloadTextFile(lines.join("\n"), buildSnFilename("SN_Visit_Series_Bundle", result));
}

export function generateSnSeriesEducationLogCsv(result: SnSeriesResult): void {
  const rows: string[] = [];
  rows.push(["topicId", "topic", "level", "firstTaught", "reinforcedCount", "masteredAt", "advancedTo"].join(","));
  (result.educationLog ?? []).forEach((e) => {
    rows.push(
      [
        csvCell(e.topicId),
        csvCell(e.topic),
        csvCell(e.level),
        csvCell(e.firstTaught ?? ""),
        String(e.reinforcedAt?.length ?? 0),
        csvCell(e.masteredAt ?? ""),
        csvCell(e.advancedToTopicId ?? ""),
      ].join(","),
    );
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, buildSnFilename("SN_Education_Log", result, "csv"));
}

export function generateSnSeriesPreClaimChecklist(result: SnSeriesResult): void {
  const lines = snHeader("PRE-CLAIM / TPE / UPIC CHECKLIST", result);
  const c = result.preClaimChecklist;
  if (!c) {
    lines.push("(checklist not generated)");
  } else {
    const mark = (v: boolean) => (v ? "[PASS]" : "[FAIL]");
    lines.push(`${mark(c.f2fLinked)} F2F encounter linked`);
    lines.push(`${mark(c.ordersOnFile)} Physician orders on file`);
    lines.push(`${mark(c.oasisCongruent)} OASIS congruent with POC`);
    lines.push(`${mark(c.measurableGoalsTied)} Measurable goals tied to documented interventions`);
    lines.push(`${mark(c.homeboundJustifiedEachVisit)} Homebound justified each visit (specific drivers)`);
    lines.push(`${mark(c.educationProgressionDocumented)} Education progression documented`);
    lines.push(`${mark(c.noClonedObjectiveFindings)} No cloned objective findings`);
    lines.push(`${mark(c.lupaAddressed)} LUPA addressed per PDGM period`);
    lines.push(`${mark(c.billableDraftReady)} Billable draft ready`);
    if (c.notes) {
      lines.push("");
      lines.push("Notes:");
      lines.push(c.notes);
    }
  }
  lines.push("");
  lines.push("LONGITUDINAL AUDIT FAILURES");
  lines.push(SN_MINOR);
  const failures = result.longitudinalAudit?.failures ?? [];
  if (failures.length === 0) {
    lines.push("None.");
  } else {
    failures.forEach((f, i) => {
      lines.push(`${i + 1}. [${f.code}/${f.severity}] ${f.message}`);
      if (f.offendingVisitIds?.length) lines.push(`   Visits: ${f.offendingVisitIds.join(", ")}`);
    });
  }
  downloadTextFile(lines.join("\n"), buildSnFilename("SN_PreClaim_Checklist", result));
}

export function generateSnSeriesAuditQAJSON(result: SnSeriesResult): void {
  const payload = {
    patientIdentifier: result.patientIdentifier,
    certPeriod: result.certPeriod,
    frequencyOrder: result.frequencyOrder,
    generatedAt: result.generatedAt.toISOString(),
    longitudinalAudit: result.longitudinalAudit,
    preClaimChecklist: result.preClaimChecklist,
    auditMeta: result.auditMeta ?? null,
    episodeSummaries: result.episodeSummaries,
    visitCount: result.visits?.length ?? 0,
    educationLog: result.educationLog,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, buildSnFilename("SN_Audit_QA", result, "json"));
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
