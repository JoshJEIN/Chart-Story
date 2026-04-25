// Frequency string parser.
// Accepts: "2w3", "2w3,1w6,1w4", "SN: 2w3,1w6,1w4 / PT: 1w4"
// Returns parsed blocks and a Mon/Wed/Fri (or weekly) schedule across the 60-day cert period.
import type { FrequencyBlock, FrequencyOrder, CertPeriod } from "@/types/snSeries";
import type { SocDisciplineOrder } from "@/types/soc";

const BLOCK_RE = /(\d+)\s*[wW]\s*(\d+)/g;
const DISCIPLINE_RE = /^(SN|PT|OT|ST|MSW|HHA)\s*:/i;

export function parseFrequencyString(raw: string, defaultDiscipline = "SN"): FrequencyOrder {
  const cleaned = (raw || "").trim();
  const segments = cleaned.split("/").map((s) => s.trim()).filter(Boolean);
  const blocks: FrequencyBlock[] = [];

  for (const seg of segments.length ? segments : [cleaned]) {
    let discipline = defaultDiscipline;
    let body = seg;
    const m = seg.match(DISCIPLINE_RE);
    if (m) {
      discipline = m[1].toUpperCase();
      body = seg.slice(m[0].length).trim();
    }
    let match: RegExpExecArray | null;
    BLOCK_RE.lastIndex = 0;
    while ((match = BLOCK_RE.exec(body)) !== null) {
      const visitsPerWeek = parseInt(match[1], 10);
      const weeks = parseInt(match[2], 10);
      if (!Number.isFinite(visitsPerWeek) || !Number.isFinite(weeks)) continue;
      blocks.push({
        weeksLabel: `${visitsPerWeek}w${weeks}`,
        visitsPerWeek,
        weeks,
        totalVisits: visitsPerWeek * weeks,
        discipline,
      });
    }
  }

  const totalVisitsScheduled = blocks
    .filter((b) => (b.discipline ?? "SN") === "SN")
    .reduce((acc, b) => acc + b.totalVisits, 0);

  return { raw: cleaned, parsed: blocks, totalVisitsScheduled };
}

export function buildCertPeriod(startISO: string): CertPeriod {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 59);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end), day60: fmt(end) };
}

// Distribute SN visits Mon/Wed/Fri (BIW), Mon/Wed/Fri (TIW), or Mon-only (weekly).
// Returns an array of ISO dates aligned with visit numbers (1-indexed).
export function buildVisitSchedule(
  startISO: string,
  blocks: FrequencyBlock[],
): { visitNumber: number; visitDate: string; weekOfEpisode: number; pdgmPeriod: 1 | 2 }[] {
  const start = new Date(startISO + "T00:00:00");
  const schedule: { visitNumber: number; visitDate: string; weekOfEpisode: number; pdgmPeriod: 1 | 2 }[] = [];
  let visitNumber = 0;
  let cursor = new Date(start);
  let weekOfEpisode = 0;

  const snBlocks = blocks.filter((b) => (b.discipline ?? "SN") === "SN");

  for (const block of snBlocks) {
    for (let w = 0; w < block.weeks; w++) {
      weekOfEpisode++;
      const weekStart = new Date(cursor);
      const pattern = patternForVPW(block.visitsPerWeek);
      for (const offset of pattern) {
        const visitDate = new Date(weekStart);
        visitDate.setDate(weekStart.getDate() + offset);
        // Don't schedule beyond day 60.
        const dayInEpisode = Math.floor((visitDate.getTime() - start.getTime()) / 86_400_000);
        if (dayInEpisode > 59) continue;
        visitNumber++;
        schedule.push({
          visitNumber,
          visitDate: visitDate.toISOString().slice(0, 10),
          weekOfEpisode,
          pdgmPeriod: dayInEpisode < 30 ? 1 : 2,
        });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  return schedule;
}

function patternForVPW(visitsPerWeek: number): number[] {
  // Day offsets from Monday. Adjust for week start being SOC date (we treat cursor as Monday of week 1).
  switch (visitsPerWeek) {
    case 1: return [0];                  // Mon
    case 2: return [0, 2];               // Mon, Wed (BIW)
    case 3: return [0, 2, 4];            // Mon, Wed, Fri (TIW)
    case 4: return [0, 1, 3, 4];
    case 5: return [0, 1, 2, 3, 4];
    case 6: return [0, 1, 2, 3, 4, 5];
    case 7: return [0, 1, 2, 3, 4, 5, 6];
    default: return Array.from({ length: visitsPerWeek }, (_, i) => Math.min(i, 6));
  }
}

// CMS PDGM LUPA thresholds (2024) by case-mix HHRG. We don't classify HHRG
// here; we only expose the lookup so the user can supply the threshold.
// Reference: range is typically 2–6 visits per 30-day period.
export function lupaRiskFor(visitsCompleted: number, threshold: number | null) {
  if (threshold == null) return { lupaRisk: "unknown" as const, lupaImpactNote: "Enter HHRG-specific LUPA threshold to compute." };
  if (visitsCompleted < threshold) {
    return {
      lupaRisk: "below" as const,
      lupaImpactNote: `Below LUPA threshold (${visitsCompleted} of ${threshold}). Period will be paid per-visit instead of full PDGM case-mix — material revenue impact.`,
    };
  }
  if (visitsCompleted === threshold) {
    return { lupaRisk: "at" as const, lupaImpactNote: `At LUPA threshold (${threshold}). One missed visit triggers per-visit payment.` };
  }
  return { lupaRisk: "above" as const, lupaImpactNote: `Above LUPA threshold (${visitsCompleted} of ${threshold}). Full PDGM payment expected.` };
}
