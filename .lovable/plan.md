## Goal

Update the **Narrative Recert SN Visit Note** generator so it (1) includes vitals when the source provides them (removing the default OASIS omission) and (2) rewrites any pasted nurse note to Texas BON / TAC §97 home-health standards and merges its content into the matching structured fields of the generated draft. Both UI display and the .docx export pick this up automatically because they render whatever the model returns.

## Scope

Single-file change to the edge function prompt — no frontend, schema, or export changes needed.

- `supabase/functions/sn-visit-draft/index.ts` → rewrite `RECERT_NARRATIVE_SYSTEM_PROMPT`
- Deploy `sn-visit-draft`

## Prompt changes

**Remove**
- "Vitals are OUT OF SCOPE" framing
- Default `VITALS_IN_OASIS` flag
- "NO VITALS LISTED in objective / all numeric vitals null" rule

**Add / replace**

1. **Vitals in-scope.** Populate every objective field for which the source gives an exact value (BP, HR, RR, SpO2, temp, weight, FSBG, pain, edema, lung/bowel sounds, ambulation, transfer). Never fabricate; missing → null + `MISSING_SOURCE` flag (severity low). Timestamp from source, else 09:00.

2. **Abnormal-vital handling (kept and tightened).** When a vital is abnormal vs the Pt's Dx/POC threshold: name it in assessment, add one dedicated skilled-intervention entry (first person, past tense, MD/pharmacy notification when applicable, teach-back, escalation/911 threshold), add `ABNORMAL_VITAL_ADDRESSED` flag.

3. **Merge nurse source note (new rule).** Treat `sourceExcerpt` as authoritative visit content and distribute — never append as a raw block:
   - Pre-visit call, bag technique, hand hygiene → first `plannedInterventions` entry
   - Vital values, pain score, FSBG → `objective` fields (exact numbers)
   - Pt-reported symptoms and denials (e.g., "no headache"), caregiver input → `subjective`
   - Dx review, med reconciliation, reasoning around abnormal findings → `assessment`
   - Each taught topic → its own `educationDelivered` entry meeting rule 4
   - Next-visit plan from the nurse note → `nextVisitFocus`
   - 911/escalation → embedded in relevant education entry and in the abnormal-vital intervention
   Rewrite to first-person past tense, "Pt"/"Cg"/initials, remove third-person "SN"/"the nurse," fix grammar, expand abbreviations on first use, and tie every skilled action to a named Dx/med/POC goal.

4. **Education rule kept** — 5 required elements (what / why-for-this-pt / diet+lifestyle+safety / teach-back Q+A / comprehension+mastery). Nurse-note teaching topics must appear here verbatim-in-substance with the five elements filled in.

5–10. Narrative depth, COC, nextVisitFocus, homeboundRestated, goalsProgress, addedFields, HIPAA, `visitType="SN-Recert"` — unchanged.

## How the pasted nurse note will land (preview)

After merge, the example you pasted would produce roughly:
- **objective**: temp 97.1, BP 122/61 (R arm, sitting), HR 62, pain 7/10 (LE + hip), FSBG 213 random
- **subjective**: pre-visit call, no headache, Pt/Cg report
- **assessment**: OA + HTN + CKD-4 + T2DM reasoning, FSBG 213 above 180 target tied to CKD-4 risk
- **plannedInterventions**: bag technique/hand hygiene; FSBG-213 skilled intervention with MD notification + 911 threshold; med reconciliation (amlodipine, furosemide, Toprol XL, glimepiride/glipizide, diclofenac, tramadol, cetirizine PRN); fall-risk/walker assist; pain assessment
- **educationDelivered**: T2DM disease+diet+meds; fall prevention/walker; 911 red flags — each with teach-back + comprehension %
- **nextVisitFocus**: response to antihypertensives/diabetes meds, CKD/DM dietary reinforcement, OA pain management
- **flags**: `ABNORMAL_VITAL_ADDRESSED` (FSBG 213)

## Out of scope

- No changes to `SnSingleVisitDisplay.tsx` or `exportReports.ts` — they already render every field the schema returns
- No changes to the `quick` mode prompt
- No schema / tool-definition changes

## Verification

- Redeploy `sn-visit-draft`
- Regenerate the recert narrative with the pasted nurse note as source; confirm vitals populated, abnormal-FSBG flag present, education entries include the three topics, no `VITALS_IN_OASIS` flag
