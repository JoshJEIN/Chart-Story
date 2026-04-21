import { AnalysisResult } from "@/types/pcr";

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

export function generateOasisPastHealthHistoryPDF(result: AnalysisResult): void {
  const lines: string[] = [];
  const date = result.generatedAt.toLocaleDateString();

  lines.push("OASIS — SIGNIFICANT PAST HEALTH HISTORY");
  lines.push(`Patient: ${result.patientIdentifier || "Unknown"}`);
  lines.push(`Episode Analyzed: ${result.episodeRange || "Unknown"}`);
  lines.push(`Generated: ${date}`);
  lines.push("=".repeat(70));
  lines.push("");
  lines.push(result.oasisPastHealthHistory || "No OASIS past health history generated.");

  downloadTextFile(lines.join("\n"), buildFilename("OASIS_Past_Health_History", result));
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
