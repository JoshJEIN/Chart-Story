
## Goal

Solve the real-world problem that nurses often write extremely short notes (vitals + a couple of phrases) by giving them two new SN-note draft generators that turn whatever they DID document into an audit-defensible, narrative-rich SN visit note — without inventing vitals when none were taken.

## Two new modes (additions, not replacements)

### Mode A — "Quick SN Visit Draft (from scribbled notes / vitals)"
For the day-to-day case: a nurse uploads a scanned scribble, a typed vitals sheet, or a short text snippet from one visit. The app produces ONE polished, billable SN visit note.

Inputs:
- Patient context: optional — either an existing SOC result in memory, or a small "Patient context" textarea (Dx, current meds, key goals).
- Visit date.
- Document upload (image, PDF, text) of the nurse's scribbles / vitals / quick notes — parsed via existing `extractTextFromDocuments` (and image-OCR through Lovable AI for handwriting).
- Visit number / week-of-episode (optional, used for context only).

Output: ONE `SnVisit`-shaped draft with:
- objective.* populated ONLY from what the source actually contains; missing fields are flagged `MISSING_SOURCE` rather than fabricated.
- assessment, plannedInterventions, skilledJustification, educationDelivered, coordinationOfCare, goalsProgress, nextVisitFocus, homeboundRestated — all expanded into proper narrative based on the scribbles + patient context.
- sources[] cites the uploaded scribble doc.
- A "What was added vs. what came from your notes" diff panel so the nurse can verify nothing was invented.

### Mode B — "Recert-Period SN Visit Draft (narrative-heavy, no vitals)"
For nurses doing the recert OASIS visit who want a narrative template that emphasizes teaching depth and clinical reasoning, with vitals deliberately omitted (they live in the OASIS).

Inputs:
- Recert packet upload (or reuse the current Recert Visit Series upload).
- Pick one specific visit slot (or "free-form, no specific date").
- Optional teaching focus (e.g. "new metformin + low-Na diet"); otherwise inferred from packet.

Output: ONE narrative-heavy SN visit note with:
- subjective + assessment expanded.
- plannedInterventions detailed and tied to specific Dx/meds.
- educationDelivered expanded for each topic with: what the topic is, WHY it matters to THIS patient's diagnosis/meds/safety, the diet / lifestyle / safety changes, teach-back questions used and the patient's actual-vs-target response, comprehension %, mastery flag.
- coordinationOfCare (MD calls, referrals, pharmacy, social work).
- nextVisitFocus.
- homeboundRestated.
- objective block intentionally suppressed (UI hides it; field present but empty / marked "see OASIS").

## UI changes (`src/pages/Index.tsx`)

- Extend `AnalysisMode` to: `"recert" | "soc" | "snSeries" | "recertSeries" | "snQuickDraft" | "snRecertDraft"`.
- Add two new `ModeCard`s in the Analysis Mode grid (grid becomes 3 cols on lg, or wraps).
- Build small input panels for each new mode (visit date, patient context textarea, single-document uploader, optional teaching focus).
- Render new `SnSingleVisitDisplay` component for the single-visit output (reuses styling from `SnVisitSeriesDisplay`, but for one visit + a "from your notes vs. expanded by AI" diff section).

## Backend (one new edge function)

Create `supabase/functions/sn-visit-draft/index.ts` with two handler paths driven by a `mode` field in the body:
- `mode: "quick"` — Quick draft from scribbles. System prompt enforces: never fabricate vitals; flag MISSING_SOURCE for anything not in the source; expand narrative around what IS there.
- `mode: "recertNarrative"` — Narrative-heavy recert visit. System prompt suppresses objective vitals, demands rich education explanations (topic, why-it-matters-to-this-pt, diet/lifestyle/med-safety changes, teach-back Q+A, comprehension, mastery), required coordinationOfCare and nextVisitFocus.

Both:
- Use Lovable AI Gateway with `google/gemini-2.5-pro`, tool-calling for structured `SnVisit` output (no number `enum`s — same fix as before).
- Standard CORS + health-check pattern from existing functions.
- Echo back `inputExcerpt` (what we extracted from the source) so the UI can render the diff.
- Return `{ visit: SnVisit, inputExcerpt: string, addedFields: string[] }`.

## New client lib + types

- `src/lib/analyzeSnVisitDraft.ts` — wraps `supabase.functions.invoke("sn-visit-draft", ...)` for both submodes.
- `src/types/snVisitDraft.ts` — `SnSingleVisitDraft` = `{ visit: SnVisit; inputExcerpt: string; addedFields: string[]; mode: "quick" | "recertNarrative" }`.
- `src/components/SnSingleVisitDisplay.tsx` — renders a single visit using the same visual language as `SnVisitSeriesDisplay`, plus a collapsible "Source vs. Expanded" panel; hides the vitals block when `mode === "recertNarrative"`.

## Anti-fabrication safeguards (Quick mode)

- AI prompt: "If a vital sign is not present in the source excerpt, leave the field empty and add `flags: [{code: 'MISSING_SOURCE', severity: 'medium', message: '<field> not documented in source'}]`. Never invent BP/HR/SpO2/weight/FSBG/pain."
- Client-side post-check: any objective field populated that does not appear (numerically, with tolerance) in `inputExcerpt` is auto-listed in `addedFields` and surfaced in the diff panel for the nurse to confirm or strike.

## Files

New:
- `supabase/functions/sn-visit-draft/index.ts`
- `src/lib/analyzeSnVisitDraft.ts`
- `src/types/snVisitDraft.ts`
- `src/components/SnSingleVisitDisplay.tsx`

Modified:
- `src/pages/Index.tsx` (mode union, two ModeCards, two input panels, two run handlers, render `SnSingleVisitDisplay`)
- `src/lib/parseDocuments.ts` (only if image OCR for scanned scribbles isn't already handled — verify first; otherwise no change)

## Out of scope

- No changes to existing recert / SOC / SN Series / Recert Series modes — they keep working exactly as today.
- No DB schema changes; output is in-memory only (consistent with current modes).
