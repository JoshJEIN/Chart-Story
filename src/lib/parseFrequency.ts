// Frequency string parser.
// Accepts: "2w3", "2w3,1w6,1w4", "SN: 2w3,1w6,1w4 / PT: 1w4"
// Returns parsed blocks and a Mon/Wed/Fri (or weekly) schedule across the 60-day cert period.
import type { FrequencyBlock, FrequencyOrder, CertPeriod } from "@/types/snSeries";
import type { SocDisciplineOrder } from "@/types/soc";

const BLOCK_RE = /(\d+)\s*[wW]\s*(\d+)/g;
const DISCIPLINE_RE = /^(SN|PT|OT|ST|MSW|HHA)\s*:/i;

// Words that mean "visits per week" in plain-English physician orders.
const VPW_WORDS: Record<string, number> = {
  qd: 7, daily: 7,
  qod: 4, // every other day ≈ 3-4/wk; we round up to be safe for scheduling
  weekly: 1, qw: 1,
  biw: 2, "bi-weekly": 2, "twice weekly": 2, "twice a week": 2, "two times a week": 2, "two times weekly": 2,
  tiw: 3, "three times weekly": 3, "three times a week": 3, "thrice weekly": 3,
  qiw: 4, "four times weekly": 4, "four times a week": 4,
  "five times weekly": 5, "five times a week": 5,
};

// Normalize a natural-language frequency segment (e.g. "BIW x 8 weeks",
// "2 visits/week for 8 weeks", "weekly x 9 wks", "1v/wk x 9wks") to a
// canonical "NwN" or "NwN, NwN" string that the strict regex understands.
// Returns the input unchanged if it already contains NwN tokens.
export function normalizeFrequencyString(raw: string): string {
  const input = (raw || "").trim();
  if (!input) return "";
  // If it already contains NwN-style blocks anywhere, treat as canonical
  // (the strict parser will pick them up as-is).
  if (/\d+\s*[wW]\s*\d+/.test(input)) return input;

  // Split on common separators ("then", ";", ","). Slashes are reserved for
  // discipline separators in the strict parser, but in plain English they
  // often mean "per" (e.g. "2 visits/week"), so we keep them inside segments.
  const segments = input
    .split(/\s*(?:then|;|,)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const canonical: string[] = [];
  for (const seg of segments.length ? segments : [input]) {
    const lower = seg.toLowerCase();
    // Pull "x N week(s)" / "for N week(s)" / "N wks"
    const weeksMatch =
      lower.match(/(?:x|for|times)\s*(\d+)\s*(?:week|wk)s?/) ||
      lower.match(/(\d+)\s*(?:week|wk)s?\b/);
    const weeks = weeksMatch ? parseInt(weeksMatch[1], 10) : NaN;

    // Find visits per week.
    let vpw: number = NaN;
    // Numeric: "2 visits/week", "2v/wk", "3 times per week", "3x/wk"
    const numericVpw = lower.match(
      /(\d+)\s*(?:v(?:isits?)?|times?|x)?\s*(?:\/|per|a)?\s*(?:wk|week)/,
    );
    if (numericVpw) vpw = parseInt(numericVpw[1], 10);
    // Word-based ("BIW", "TIW", "weekly", "daily", ...)
    if (!Number.isFinite(vpw)) {
      for (const [word, n] of Object.entries(VPW_WORDS)) {
        const re = new RegExp(`\\b${word.replace(/-/g, "[\\s-]?")}\\b`, "i");
        if (re.test(lower)) { vpw = n; break; }
      }
    }

    if (Number.isFinite(vpw) && Number.isFinite(weeks) && vpw > 0 && weeks > 0) {
      canonical.push(`${vpw}w${weeks}`);
    }
  }

  return canonical.length ? canonical.join(", ") : input;
}

export function parseFrequencyString(raw: string, defaultDiscipline = "SN"): FrequencyOrder {
  const cleaned = (raw || "").trim();
  // Normalize plain-English orders before strict parsing. We preserve the
  // user's original string in `raw` so the UI shows what they typed.
  const normalized = normalizeFrequencyString(cleaned);
  const segments = normalized.split("/").map((s) => s.trim()).filter(Boolean);
  const blocks: FrequencyBlock[] = [];

  for (const seg of segments.length ? segments : [normalized]) {
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

// Find the SN entry in a POC's disciplineOrders[] and return its frequencyDuration string,
// plus a parsed FrequencyOrder for direct comparison and a canonical "NwN, NwN"
// form derived from natural-language orders ("BIW x 8 weeks" → "2w8").
export function extractSnFrequencyFromPOC(
  disciplineOrders: SocDisciplineOrder[] | undefined | null,
): { raw: string; canonical: string; parsed: FrequencyOrder } | null {
  if (!disciplineOrders || disciplineOrders.length === 0) return null;
  const sn = disciplineOrders.find((d) => /^sn\b|skilled\s*nursing/i.test(d.discipline ?? ""));
  if (!sn || !sn.frequencyDuration) return null;
  const raw = sn.frequencyDuration.trim();
  const canonical = normalizeFrequencyString(raw);
  const parsed = parseFrequencyString(raw);
  return { raw, canonical, parsed };
}

// Compares two parsed frequency totals (POC vs user-typed). Used for the
// front-end gating + the edge function's audit criterion (k).
export function frequencyTotalsMatch(a: FrequencyOrder | null, b: FrequencyOrder | null): boolean {
  if (!a || !b) return false;
  return a.totalVisitsScheduled === b.totalVisitsScheduled && a.totalVisitsScheduled > 0;
}
