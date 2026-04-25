## Goal

Two related changes that share the same architecture:

1. **Bind the SN Visit Series to the physician-ordered frequency on the 485** so the app cannot silently drift from what the POC actually orders.
2. **Add a fourth mode — "Recert Visit Series"** — that generates SN visit notes for a *subsequent* 60-day cert period using freshly uploaded recertification documents (Recert OASIS, updated 485/POC, latest physician orders, current med profile, specialist notes, labs, recent SOAP/SN notes). Education topics advance from where the prior period left off — no repeats of mastered content.

---

## Part 1 — POC-ordered frequency becomes the source of truth

### Behavior

- When the user opens **SN Visit Series** mode, the app reads `socResult.planOfCare.disciplineOrders` and finds the SN entry. Its `frequencyDuration` (e.g., `"2w8"`, `"2w3, 1w6, 1w4"`) becomes the **default** value of the frequency input.
- A read-only chip shows the **POC-ordered frequency** next to the input with a "Use POC frequency" button.
- If the user types something different, a yellow warning chip appears: *"Differs from physician orders — verbal order required."*
- A new optional field, **Verbal Order Reference** (date + ordering MD), unlocks override. Without it, the Generate button is disabled when the typed frequency's total visits ≠ the POC's parsed total.
- The verbal order, if provided, is passed to the edge function and recorded in every visit note's `coordinationOfCare` and in `preClaimChecklist.notes`.

### Edge function changes (`sn-series-analyze`)

- Accept new fields: `expectedFrequencyFromPOC` (string), `verbalOrder` (`{date, orderingMd, content} | null`).
- Add audit criterion **(k)**: `frequencyOrder.raw` must match `expectedFrequencyFromPOC` **OR** `verbalOrder` must be present. Failure code `FREQ_POC_MISMATCH` (severity high) blocks `longitudinalAudit.pass`.
- When `verbalOrder` is present, the system prompt instructs the model to cite it in `preClaimChecklist.notes` and in the first visit's `coordinationOfCare`.

### Files touched (Part 1)

- `src/lib/parseFrequency.ts` — add `extractSnFrequencyFromPOC(disciplineOrders)` helper that finds the SN order and parses it.
- `src/pages/Index.tsx` — pre-fill `frequencyRaw` from `socResult` on mode switch; render POC chip + warning + verbal-order field; gate the Generate button.
- `src/lib/analyzeSnSeries.ts` — forward `expectedFrequencyFromPOC` and `verbalOrder` to the edge function.
- `supabase/functions/sn-series-analyze/index.ts` — accept the new fields, inject into system prompt, add audit criterion (k).
- `src/types/snSeries.ts` — add `verbalOrder` field on `SnSeriesResult` and the new audit code.

---

## Part 2 — Recert Visit Series (subsequent 60-day periods)

### Why a separate mode (vs. reusing SN Visit Series)

The SOC mode is admission-specific: it builds a 485 from intake docs and seeds *first-time* education topics. A recertification cycle uses a **Recert OASIS**, an **updated POC**, fresh **physician orders**, and — critically — must **continue** education from the prior episode without re-teaching mastered topics. Different inputs, different audit posture, different output framing. It earns its own mode.

### Flow

```text
[Recert Mode]
   │
   ▼
1. Upload Recert packet (Recert OASIS, updated 485/POC, latest MD orders,
   current med profile, specialist notes, labs, recent SN/SOAP notes)
   │
   ▼
2. (Optional) Attach prior SN Series result — JSON paste OR auto-pickup
   from the in-memory result if user just finished one.
   │
   ▼
3. Edge function `recert-series-analyze`:
   a. Parses Recert OASIS + updated POC → produces a refreshed
      `planOfCare` (same shape as SOC POC, no discharge planning)
   b. Reconciles education topics:
        • Drops mastered topics
        • Carries forward in-progress topics
        • Adds new topics for new dx / new meds / new orders
   c. Generates the full 60-day SN visit series for the new cert
      period using the same audit loop as `sn-series-analyze`
   │
   ▼
4. Display results (reuses SnVisitSeriesDisplay) + export
```

### Education continuity logic

- New helper `reconcileEducationTopics(prior, newSocSeed)`:
  - **Drop** any topic where `priorEducationLog[topicId].masteredAt != null`.
  - **Carry forward** topics that are in-progress (`firstTaught != null && masteredAt == null`) at their current level.
  - **Add** topics seeded from new dx/meds/orders not present in prior list.
  - Pass the reconciled list + a `priorEducationLog` snapshot to the edge function so it does not re-teach mastered content.

### Recert-specific audit additions

- `RECERT_MASTERED_TOPIC_RETAUGHT` — high severity if any visit teaches a topic flagged mastered in the prior log.
- `RECERT_NEW_DX_NOT_ADDRESSED` — medium if a dx present in updated POC but absent in prior POC has zero teaching/intervention.
- `RECERT_NO_FREQ_CHANGE_RATIONALE` — medium if frequency order differs from prior period and no rationale appears in `coordinationOfCare` of visit #1.

### Files added (Part 2)

- `supabase/functions/recert-series-analyze/index.ts` — new edge function. Same security/CORS/health-probe pattern. System prompt extends the SN-series prompt with the recert-specific rules.
- `src/lib/analyzeRecertSeries.ts` — client wrapper, mirrors `analyzeSnSeries.ts`.
- `src/lib/reconcileEducation.ts` — pure helper for topic carry-forward.
- `src/types/recertSeries.ts` — `RecertSeriesResult` extends `SnSeriesResult` with `priorEpisodeRef`, `educationCarriedForward[]`, `educationDropped[]`, `newDxAddressed[]`.

### Files modified (Part 2)

- `src/pages/Index.tsx` — fourth mode card "Recert Visit Series". New uploader helper text listing the recert packet docs. Optional "Paste prior series JSON" textarea OR auto-detect if `seriesResult` already in state. SOC start date input becomes "Recert episode start date".
- `src/components/SnVisitSeriesDisplay.tsx` — small additions to surface "Education carried forward / dropped / new" panel when present.
- `src/lib/exportReports.ts` — recert-mode export adds the carry-forward summary.

---

## UX summary

**Mode toggle (4 cards):**

```text
[ Recertification (PCR) ]   [ Admission / SOC ]
[ SN Visit Series (60d) ]   [ Recert Visit Series (subsequent 60d) ]
```

**SN Visit Series mode header now shows:**

```text
POC frequency (from 485):  2w8                    [Use POC frequency]
Your frequency:            [ 2w8                ]
✓ Matches physician orders
```

or, on mismatch:

```text
POC frequency (from 485):  2w8
Your frequency:            [ 2w3, 1w6, 1w4     ]
⚠ Differs from physician orders — enter verbal order to proceed
Verbal order:  Date [____]  Ordering MD [____________]  Content [______________]
```

**Recert Visit Series mode adds:**

- Upload section labeled *"Upload Recertification Packet"* with the doc list from your message.
- Collapsible *"Prior episode (optional but recommended)"* — auto-filled if a series was just generated, or accepts pasted JSON.

---

## Out of scope / explicitly NOT changing

- No discharge planning anywhere (already removed; staying out).
- No persistence layer yet — prior-episode handoff is in-memory or paste-JSON. A persistence layer (so prior episodes survive a refresh) is the obvious next step but not included here unless you ask.
- No multi-discipline scheduling (PT/OT/ST). Series remains SN-only; other disciplines are still surfaced in the POC display.

---

## Deliverable order

1. Part 1 (POC frequency binding) — small, high-value, fully isolated.
2. Part 2 (Recert Visit Series mode) — new edge function + new mode + education reconciliation.
3. Health-check button auto-routes to the new function when the mode is active.
4. Verify with a dry-run health probe on the new function after deploy.
