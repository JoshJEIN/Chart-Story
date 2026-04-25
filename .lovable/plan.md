# Add Start-of-Care (Admission) Clinical Analysis

## What you'll get

A second analysis mode in the same app: **Start-of-Care (SOC) / Admission Care-Planning Analysis**, separate from the existing Recertification flow. The user toggles which mode to run *before* uploading. One mode runs per session. The new mode reads the admission packet (physician orders, OASIS SOC, 485/POC, F2F, H&P/discharge summary, doctor's notes) and produces a forward-looking, Medicare-compliant care plan plus a first SN visit note template and a patient/caregiver education plan.

The new mode borrows the clinical content depth from your **Clinical Navigator** project (first-episode analyzer, SN visit note draft, education plan with full teach-back narratives), but is rewritten to follow this app's existing standards: chart-story tone, mandatory STEP 1–6 audit loop, source-table citations, deterministic JSON contract via tool calling, and downloadable reports.

## Mode toggle (top of page)

```text
┌────────────────────────────────────────────────────────────┐
│ Analysis Mode:  ( ) Recertification   (•) Admission / SOC  │
└────────────────────────────────────────────────────────────┘
```

Switching mode clears any prior result. The uploader, helper text, and analyze button label all update to match the chosen mode. Only the active mode's edge function is called.

## What the SOC mode produces (downloadables)

1. **Admission Chart Story + Significant PMHx** — same 4-paragraph structure as recert, but framed as "reason for admission, baseline status, drivers of skilled need."
2. **Plan of Care Summary (485-aligned)** — diagnoses (primary + secondary), homebound justification with specific clinical drivers, skilled need rationale, measurable goals (timed/objective), discipline orders with frequency/duration, DME/supplies, discharge criteria.
3. **First SN Visit Note Template** — pre-filled SOAP-style note for the first scheduled visit: focused assessment areas, vitals to capture, disease-process teaching points to cover, safety checks, expected interventions. Clinician edits, signs, uses.
4. **Patient/Caregiver Education Plan** — topics tied to the patient's diagnoses, meds, and safety risks, written in the *expanded* teach-back style from Clinical Navigator (no "education provided" one-liners — full plain-language explanations of what the disease is, signs/symptoms, dietary specifics, med purpose, warning signs, when to call). Includes teach-back questions per topic.
5. **Audit QA JSON** — STEP 6 pass/fail with failing criteria (same format as recert).

All five render in the existing `AnalysisDisplay` style and export through the existing `exportReports` pattern.

## Compliance & audit guardrails (non-negotiable)

The SOC system prompt enforces the same discipline as the recert prompt:

- **STEP 1** — internal clinical extraction from source docs only; mark `[NOT DOCUMENTED]` rather than fabricate.
- **STEP 2** — prioritization by risk / functional impact / skilled-need driver.
- **STEP 3** — baseline establishment (this is SOC, so baseline = admission state; trajectory is "starting point + risks going forward" instead of "before → after").
- **STEP 4** — narrative synthesis (4 paragraphs: dx & history, comorbidities, admission clinical picture & drivers, functional impact & skilled need).
- **STEP 5** — deliverable composition with source citations.
- **STEP 6** — audit gate. Adds SOC-specific criteria:
  - Homebound status has at least one specific clinical driver (taxing effort, assistive device, dyspnea on exertion, cognitive safety risk, etc.) — never generic.
  - Skilled need names the specific SN interventions (med teaching, observation/assessment for instability, wound care, glucose mgmt, anticoagulation monitoring, disease-process teaching) and ties each to a documented dx.
  - Every goal is **measurable and timed** ("Pt will demonstrate correct insulin draw-up and injection technique by visit 4") — vague goals fail audit.
  - F2F encounter is referenced or flagged missing.
  - Med list is reconciled against POC and dx (mismatches surfaced as red flags, not corrected silently).
  - Education plan content includes the actual explanation, not just the topic name (Clinical Navigator's "BAD vs GOOD" rule).
- **Audit loop**: same retry mechanism as recert — `maxIterations` slider applies. Audit fails → orchestrator re-invokes with revision instructions until pass or limit.
- **HIPAA**: "Pt" / initials only in narrative; real full name only in the dedicated `patientFullName` field used solely for filenames.
- **No invention**: missing data is flagged, never filled in.

## Technical design

### New edge function: `supabase/functions/soc-analyze/index.ts`

Mirrors `pcr-analyze` exactly:
- Same CORS headers, same `Deno.serve`, no std imports.
- Same health-check probe (GET `/health`, `?health=1`, or POST `{health:1}`).
- Same payload validation (per-doc 80k char cap, 600k total, 9MB body limit).
- Same Lovable AI Gateway call (`google/gemini-2.5-pro` for clinical depth; falls back to `gemini-2.5-flash` if needed — match whatever recert uses).
- Same audit loop orchestration with `maxIterations`.
- Same structured-output via tool calling (`soc_analysis` tool), so the response shape is deterministic.
- Surfaces 429 / 402 errors with the same friendly messages.

The system prompt is **new and SOC-specific** (not a copy of the recert prompt). It is built by combining: the discipline scaffold from this app's recert prompt (STEP 1–6, language rules, date rules, enforcement rule) + the clinical content rules from Clinical Navigator's `analyze-documents` (BASE_RULES, education expansion, condition-specific teaching, episode identification, POC template structure).

### Tool-calling JSON contract returned by the function

```text
{
  patientIdentifier, patientFullName, episodeInfo {…},
  admissionChartStory, significantPastHealthHistory,
  planOfCare {
    primaryDx, secondaryDx[],
    homeboundJustification, skilledNeedRationale,
    measurableGoals[], disciplineOrders[],
    dmeSupplies, dischargePlanning
  },
  firstSnVisitNote {
    subjective, objectiveFocus[], assessment,
    plannedInterventions[], teachingTopics[], safetyChecks[]
  },
  educationPlan [
    { topic, whyItMatters, fullExplanation, signsToWatch[],
      dietaryGuidance, medGuidance, teachBackQuestions[] }
  ],
  redFlags[], medicationReconciliation[], sourceTable[],
  auditPass, auditFailures[], _auditMeta
}
```

### New client files

- `src/lib/analyzeAdmission.ts` — mirror of `analyzeDocuments.ts`, calls `soc-analyze` with the same payload-size guards and `maxIterations`.
- `src/types/pcr.ts` — extend with `AdmissionAnalysisResult` (or a new `src/types/soc.ts`).
- `src/components/AdmissionAnalysisDisplay.tsx` — renders the four narrative sections + education accordion + audit summary, styled to match `AnalysisDisplay`.
- `src/lib/exportReports.ts` — add four new `.docx`/`.txt` exporters mirroring the existing pattern (chart story, POC summary, SN visit note, education plan). Keep the audit JSON exporter generic.

### `src/pages/Index.tsx` changes

- Add `mode: "recert" | "soc"` state, defaulting to `"recert"`.
- Add a small `RadioGroup` toggle at the top of `<main>` above the uploader. Disabled while `isAnalyzing`. Switching mode clears `analysisResult` and `documents`.
- Uploader helper text and category presets switch per mode (SOC mode emphasises physician orders, OASIS SOC, 485/POC, F2F, H&P/DC summary).
- The analyze button label and handler branch on mode: `analyzeDocuments` vs `analyzeAdmission`.
- The same `maxIterations` slider applies to both modes.
- The health-check button stays as-is (probes `pcr-analyze`); we add a parallel probe for `soc-analyze` only if you want — otherwise one health button is enough (note added in chat).
- Result rendering branches: recert → `AnalysisDisplay`; soc → `AdmissionAnalysisDisplay`.

### Deployment

Edge functions auto-deploy. After deploy I'll smoke-test `soc-analyze` health + a small fixture before handing back.

## Out of scope (intentionally)

- No follow-up SN visit note generator beyond the **first** visit (you selected "First SN visit note template"). A recurring follow-up generator can be a later add.
- No DOCX template visual redesign — reuses your existing exporter style.
- No new auth, storage, or DB tables — the app stays stateless.
- No changes to the existing recert flow or its prompt.

## Files to add / change

**Add**
- `supabase/functions/soc-analyze/index.ts`
- `src/lib/analyzeAdmission.ts`
- `src/components/AdmissionAnalysisDisplay.tsx`
- `src/types/soc.ts` (or extend `src/types/pcr.ts`)

**Edit**
- `src/pages/Index.tsx` (mode toggle, branching)
- `src/lib/exportReports.ts` (4 new exporters)

## Open question I'll handle during implementation

The Clinical Navigator function uses a single mega-prompt that returns ~25 fields. I'll trim it to only the four deliverables you picked + audit metadata, so the model spends its tokens on depth (full education narratives, measurable goals) instead of breadth. If during testing the audit loop is failing on the education-content-depth criterion, I'll bump the default model to `google/gemini-2.5-pro` for SOC mode only.
