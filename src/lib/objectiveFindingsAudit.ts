// Anti-clone deterministic comparator for time-stamped objective findings.
// Flags consecutive visits where vitals or wound measurements are identical
// (no physiologic variance) — the most common pre-claim red flag for "cloned"
// nurse documentation.
import type { SnVisit, SnLongitudinalAuditFailure } from "@/types/snSeries";

export function auditObjectiveFindings(visits: SnVisit[]): SnLongitudinalAuditFailure[] {
  const failures: SnLongitudinalAuditFailure[] = [];

  for (let i = 1; i < visits.length; i++) {
    const prev = visits[i - 1];
    const cur = visits[i];
    const offending = [prev.visitId, cur.visitId];
    const p = prev.objective ?? ({} as any);
    const c = cur.objective ?? ({} as any);

    const flatVitals =
      vitalsPresent(p) &&
      vitalsPresent(c) &&
      p.bp === c.bp &&
      p.hr === c.hr &&
      p.rr === c.rr &&
      p.spo2 === c.spo2 &&
      p.weight === c.weight &&
      p.painScore === c.painScore;

    if (flatVitals) {
      failures.push({
        code: "CLONED_VITALS",
        severity: "high",
        message: `Consecutive visits ${prev.visitNumber} → ${cur.visitNumber} have identical vitals (BP/HR/RR/SpO2/weight/pain). Physiologic variance expected — likely cloned documentation. Pre-claim risk.`,
        offendingVisitIds: offending,
      });
    }

    // Wound measurement clone check: if both visits document a wound, dimensions cannot be exactly equal forever.
    if (p.wound && c.wound && sameWoundLocation(p.wound.location, c.wound.location)) {
      const same =
        p.wound.lengthCm === c.wound.lengthCm &&
        p.wound.widthCm === c.wound.widthCm &&
        p.wound.depthCm === c.wound.depthCm &&
        p.wound.tissueType === c.wound.tissueType &&
        p.wound.drainage === c.wound.drainage;
      if (same) {
        failures.push({
          code: "FLAT_WOUND",
          severity: "medium",
          message: `Wound measurements at ${c.wound.location} unchanged across visits ${prev.visitNumber} → ${cur.visitNumber}. Document trend rationale or expect TPE/UPIC challenge.`,
          offendingVisitIds: offending,
        });
      }
    }
  }

  // Plausibility ranges (visit-to-visit deltas).
  for (let i = 1; i < visits.length; i++) {
    const p = visits[i - 1].objective ?? ({} as any);
    const c = visits[i].objective ?? ({} as any);
    if (typeof p.weight === "number" && typeof c.weight === "number") {
      const delta = Math.abs(c.weight - p.weight);
      if (delta > 5) {
        failures.push({
          code: "IMPLAUSIBLE_WEIGHT_DELTA",
          severity: "medium",
          message: `Weight changed ${delta.toFixed(1)} lb between visits ${visits[i - 1].visitNumber} → ${visits[i].visitNumber}. Document edema event or recheck — outside typical visit-to-visit range.`,
          offendingVisitIds: [visits[i - 1].visitId, visits[i].visitId],
        });
      }
    }
  }

  return failures;
}

function vitalsPresent(o: any): boolean {
  return Boolean(o.bp || o.hr || o.weight || typeof o.painScore === "number");
}

function sameWoundLocation(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
