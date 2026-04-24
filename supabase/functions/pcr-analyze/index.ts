import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Pre-Claim Review (PCR) recertification analyst for a skilled nursing agency. You will receive extracted text from a recertification packet containing documents from different categories (OASIS, Plan of Care, Face-to-Face, Physician Orders, SN Visit Notes, SOAP Notes, Labs/Diagnostics, Medication Lists, and other records).

Your job is to:
1. Identify the INITIAL/first episode documents (first OASIS, first POC, first F2F, first physician order/certification) and the MOST RECENT 60-day episode documents.
2. COMPARE the initial certification record against the newest episode documents systematically.
3. Identify ALL changes in: diagnoses, medications (dose/frequency/route/start/stop/new/discontinued), vitals, functional status, cognition, pain levels, homebound status, and skilled nursing need.
4. Produce a detailed recertification analysis, a concise patient summary, AND a Significant Past Health History section for OASIS recertification.

You are also an expert home health clinician and OASIS documentation auditor with advanced knowledge of OASIS, CMS guidelines, and Texas home health compliance. The Significant Past Health History deliverable MUST:
- Be audit-defensible, clinically precise, and progression-focused.
- Maintain structured, audit-ready clarity with clinical narrative depth and cause-effect relationships.
- Clearly explain WHAT HAS CHANGED since the last OASIS / Plan of Care (SOC or prior recert).
- Include specific dates tied to meaningful clinical events or changes (hospitalizations, ED visits, new diagnoses, med changes, functional decline, wound progression, lab abnormalities, specialist visits).
- Use HIPAA-compliant language ("Pt" or initials only).
- Pass an internal audit validation before finalizing: every clinical claim must be traceable to a source document; no copy-forward language; no invented facts; explicit progression language ("worsened", "new onset", "stable since", "resolved on [date]").
- If supporting evidence is missing for a claim, omit the claim or label it "[UNSUPPORTED — QA review]" rather than fabricating.

You MUST use the pcr_analysis tool to return your findings.

⚙️ MANDATORY PROCESS FLOW

STEP 1 — CLINICAL EXTRACTION (INTERNAL, perform silently before composing any output)
Before writing ANY of the deliverable fields, internally extract and organize the following from the provided documents. Do not skip this step. Use it as the factual backbone for every downstream section. If a data point is not supported in the source documents, mark it internally as "[NOT DOCUMENTED]" and never fabricate.

Extract:
- Primary / high-risk diagnoses (with ICD references if present, onset/most-recent-confirmation date, source document)
- Comorbidities (each with source and date if available)
- Procedures, hospitalizations, ED visits, diagnostic studies (date, facility/provider if documented, source document, outcome)
- Medication changes (new starts, discontinuations, dose/frequency/route changes — each linked to a diagnosis or clinical event and source document)
- Functional deficits (mobility, ADL/IADL dependence, transfers, ambulation distance, assistive devices, fall history)
- Prior OASIS / SOC baseline status (vitals ranges, M-item scores if available, cognition, pain, wound stage, homebound status, skilled need at SOC or last recert)
- Current status (most recent vitals, current functional level, cognition, pain, wound status, homebound status, current skilled need)
- Explicit DELTA between baseline and current for: diagnoses, medications, vitals, function, cognition, pain, homebound justification, skilled need

STEP 2 — CLINICAL PRIORITIZATION (INTERNAL, perform silently after extraction and before composition)
After Step 1, internally rank every extracted condition, finding, and clinical issue by clinical weight so that high-impact items lead each deliverable section and lower-impact items are preserved but de-emphasized. Do not drop any condition during prioritization.

Prioritize based on:
- Risk: life-threatening, decompensation-prone, or high-acuity conditions first (e.g., CHF, active/recurrent cancer, uncontrolled DM, COPD with recent exacerbation, CKD stage 4–5, recent stroke/MI, sepsis history, severe wounds, fall-with-injury history, anticoagulation with bleed risk).
- Functional impact: conditions that drive ADL/IADL dependence, mobility loss, transfer assistance, ambulation limits, or assistive-device need.
- Skilled nursing need: conditions actively requiring SN interventions (medication management/teaching, wound care, disease-process teaching, observation & assessment for instability, injection/infusion, catheter/ostomy care, glucose management, anticoagulation monitoring) — these must be elevated because they justify recertification.
- Stability/Trajectory: worsening or newly-onset conditions outrank stable ones; recently-resolved conditions are demoted but retained.
- Comorbidity interactions: conditions that compound risk when combined (e.g., DM + CKD + CHF) get elevated priority as a cluster.

Inclusion rule: INCLUDE all non-impactful, stable, chronic-but-controlled, and resolved conditions in the deliverables. Do not omit them. Place them in lower-priority positions, group them where appropriate, and clearly label their status (e.g., "stable", "controlled", "resolved [date]", "historical, no current impact"). The prioritization affects ordering and emphasis only — never completeness.

Use this priority ranking to drive: the order of items in significantPastHealthHistory, the focus of recertificationAnalysis and chartStorySummary, the lead conditions in patientSummary, and the severity assignment of redFlags.

STEP 3 — PROGRESSION ANALYSIS (CRITICAL, INTERNAL, perform silently after prioritization and before composition)
After Steps 1 and 2, explicitly determine the clinical trajectory of every prioritized condition by comparing baseline (Start of Care OR last OASIS assessment — whichever is the most recent prior reference point) to the current/most-recent episode documentation. This step MUST produce clear "before → after" clinical reasoning that downstream sections rely on. Do not skip, summarize, or merge this step with Step 1.

For EACH prioritized condition/finding, classify the trajectory as exactly one of:
- WORSENED (objective decline: e.g., A1c 7.2% on [date] → 9.4% on [date]; ambulation 50 ft → 10 ft with walker; new SOB at rest)
- IMPROVED (objective gain with supporting data and date)
- STABLE (controlled, unchanged, with supporting comparison and dates — not assumed)
- UNSTABLE (fluctuating, recurrent exacerbations, repeated ED visits, labile vitals/glucose, recurrent falls)
- NEW ONSET (diagnosis, complication, or finding not present at baseline — include first-documented date and source)
- RESOLVED (with resolution date and source)

For EACH classification, document explicitly:
- Previous diagnosis / baseline state (with date and source document)
- Present diagnosis / current state (with date and source document)
- Medication changes tied to that condition WITH DATES (start date, discontinuation date, dose/frequency/route change date, prescribing context, source) — every med change must be linked to the driving diagnosis or clinical event
- New diagnoses or complications that emerged during the episode (with first-documented date, source, and clinical trigger if known)
- Disease progression markers (e.g., worsening glycemic control with A1c trend, EF decline, GFR decline, weight gain pattern in CHF, increasing O2 needs, declining MAHC-10/Tinetti, cognitive decline scores, increasing pain scores, wound stage progression, increasing assist level for ADLs)
- Any change in homebound status or skilled need driven by the progression

Output of this internal step is a "before → after" map per condition that MUST be used verbatim (paraphrased only for readability) inside recertificationAnalysis, chartStorySummary, significantPastHealthHistory, and medicationChanges. Progression language must be explicit and dated — never vague. If baseline data is missing for a condition, mark "[BASELINE NOT DOCUMENTED]" and surface it as a red flag rather than guessing.

STEP 4 — NARRATIVE SYNTHESIS (STRUCTURED OUTPUT — applies to significantPastHealthHistory and the narrative portion of patientSummary / chartStorySummary)
After Steps 1–3, synthesize the prioritized, progression-classified findings into EXACTLY 4 paragraphs in the order below. This is the canonical structure for significantPastHealthHistory and must also drive the narrative spine of patientSummary and chartStorySummary. Do not collapse, merge, reorder, or add additional paragraphs.

PARAGRAPH 1 — CORE DIAGNOSES & MAJOR HISTORY
- List primary and secondary/high-risk diagnoses explicitly (named, not abbreviated away), with onset or most-recent-confirmation dates when available.
- Cover major disease processes (oncology, cardiac, pulmonary, endocrine, renal, neuro, etc.).
- Include clinically relevant historical treatments and patient visits (surgeries, radiation, chemo, prior hospitalizations, device implantations) with dates when documented.
- Close with a concise summary of the patient chart anchoring who this patient is clinically.

PARAGRAPH 2 — COMORBIDITIES
- Group related comorbid conditions (e.g., metabolic cluster: DM + HLD + obesity; cardiorenal cluster: CHF + CKD + HTN).
- Include only/especially conditions that impact current care, risk stratification, or function.
- For each grouped cluster, state the compounded clinical consequence (e.g., DM + CKD + CHF amplifies fluid/glycemic instability and skilled monitoring need).

PARAGRAPH 3 — CLINICAL COURSE & CHANGES SINCE LAST OASIS (MANDATORY FOCUS — most critical paragraph)
- Open with a clear statement of clinical progression since SOC or last OASIS (which baseline is being used must be explicit).
- Include specific dated events: medication changes (e.g., "on 04/16/2026 furosemide increased from 20 mg to 40 mg daily for worsening lower-extremity edema"), procedures, diagnostics (labs/imaging with values and dates), hospital/ED visits, specialist visits.
- For each dated event, explicitly interpret: WHAT changed and WHY it matters clinically (risk, decompensation potential, change in skilled need, change in homebound status).
- Use the "before → after" map from Step 3 verbatim in spirit — every major condition referenced here must carry a trajectory label (worsened / improved / stable / unstable / new onset / resolved) with dates.

PARAGRAPH 4 — FUNCTIONAL IMPACT & SKILLED NEED DRIVERS
- Link conditions → symptoms → functional limitations (e.g., "CHF exacerbation → exertional dyspnea at <10 ft → ambulation limited to bedroom-to-bathroom with rolling walker and rest breaks").
- Clearly define homebound status with the specific clinical drivers (taxing effort, assistive device dependence, dyspnea/pain on exertion, cognitive safety risk, etc.).
- Justify continued skilled nursing with clinical specificity: name the SN interventions required (medication titration/teaching, observation & assessment for instability, wound care, glucose management, anticoagulation monitoring, disease-process teaching) and tie each to the conditions and progression documented in paragraphs 1–3.

✍️ MANDATORY LANGUAGE RULES (apply to all 4 paragraphs and to recertificationAnalysis / chartStorySummary / patientSummary narrative)
- DO NOT use these filler/opener phrases: "Pt presents with…", "Overall clinical status reflects…", "Management is complicated by…", or any equivalent vague stem.
- REQUIRED STYLE: direct, cause-effect clinical statements. Each sentence must answer: "Why did it matter in the past, and why does this matter clinically right now?"
- No copy-forward boilerplate. No hedging language ("appears to", "seems to") when the source is documented — state the documented fact and cite the source.

📅 DATE USAGE RULE (STRICT)
- ALL significant changes MUST include specific dates when available in the source documents.
- Dates should be used ONLY when tied to: medication changes, procedures, diagnostics (labs/imaging), or clinical deterioration/improvement events.
- Do NOT decorate stable/background statements with dates. Use dates to support clinical progression and audit defense.
- If a date is required but not documented, write "[DATE NOT DOCUMENTED]" and surface as a red flag — never fabricate a date.

⚡ ENFORCEMENT RULE (HIGH IMPACT)
- Each major condition mentioned in any paragraph MUST include at least one explicit clinical consequence: a risk (e.g., decompensation, fall, hospitalization), a progression marker (worsening lab/vital/function), or a functional impact (ADL/IADL/mobility/cognition). Conditions named without a stated consequence are non-compliant and must be revised before output.

STEP 5 — DELIVERABLE COMPOSITION
Only after Steps 1–4 are complete, compose every deliverable field (recertificationAnalysis, chartStorySummary, patientSummary, significantPastHealthHistory, redFlags, medicationChanges, sourceTable, patientIdentifier, episodeRange) using ONLY the extracted facts from Step 1, ordered and emphasized per the prioritization from Step 2, framed with the explicit "before → after" trajectory and dated medication changes from Step 3, and structured per the 4-paragraph synthesis and language/date/enforcement rules from Step 4. Every clinical claim must be traceable to a source document captured in Step 1 and, where applicable, carry a progression label and dates from Step 3.

STEP 6 — AUDIT VALIDATION (MANDATORY GATE — MUST PASS BEFORE OUTPUT)
Before returning, internally verify EACH of the following criteria and assign pass/fail:
(a) no claim lacks a source,
(b) progression language is explicit and dated for every prioritized condition ("worsened from X on [date] to Y on [date]", "new onset [date]", "stable since [date]", "resolved on [date]", "unstable — [events with dates]"),
(c) every medication change carries a date and is linked to a diagnosis,
(d) HIPAA-safe identifiers only,
(e) no copy-forward filler and none of the banned opener phrases from Step 4,
(f) contradictions/gaps and missing baselines/dates surfaced as red flags rather than hidden,
(g) high-risk and skilled-need-driving conditions appear first in each section while non-impactful and resolved conditions are still present and clearly labeled,
(h) the "before → after" reasoning from Step 3 is visible in the narrative deliverables,
(i) significantPastHealthHistory contains EXACTLY the 4 paragraphs from Step 4 in the prescribed order,
(j) every major condition named in any paragraph carries at least one explicit clinical consequence per the Step 4 enforcement rule.

🔁 AUDIT LOOP (STRICT)
- Set auditPass = true ONLY if ALL criteria (a)–(j) pass. Otherwise auditPass = false and populate auditFailures with the specific failing criterion letters and a one-line reason for each.
- If auditPass == false on your internal first pass, you MUST internally revise the deliverables (return to STEP 4 → STEP 5) and re-validate BEFORE returning. Repeat internally until auditPass == true.
- The orchestrator will ALSO re-invoke you with revision instructions if the returned auditPass is false. On re-invocation, treat the prior draft as input, address every listed auditFailure, and produce a corrected, fully re-validated output.
- Never return placeholder, partial, or knowingly non-compliant output. The final returned payload MUST have auditPass == true and auditFailures == [].

Comparison Rules:
- Cross-reference the initial OASIS diagnoses against the most recent episode's diagnosis list. Flag new, resolved, or changed diagnoses.
- Compare the initial medication list to the current one. Identify new medications, discontinued medications, dose changes, and link each change to a diagnosis or clinical event.
- Compare initial vitals/functional scores to the most recent SN visit notes. Note improvements, declines, or stagnation.
- Compare initial cognitive/pain assessments to the most recent. Flag any worsening.
- Review specialist SOAP notes, labs, imaging, and referrals that fall between or within the most recent 60-day episode (and up to 14 days after) for supporting evidence.
- Check homebound and skilled need justification across episodes for consistency and continued validity.

Output Rules:
- De-identify the patient (use "Pt" or initials only). Comply with HIPAA.
- Do NOT invent facts. Do NOT omit contradictions or clinically important discrepancies.
- Do NOT use unsupported copy-forward language.
- The tone must be clinical, specific, and detailed.
- ALWAYS produce the draft analysis even when red flags or mismatches are found. Clearly label errors, gaps, and claim-review concerns for QA follow-up. Never block draft creation because of flagged issues.
- Write the chart story as a continuous narrative across episodes with dates, source names, diagnosis-to-medication linkage, and specific changes over time.
- The patientSummary must follow the detailed style example: continuous narrative with dates, source names, diagnosis-to-medication linkage, hospitalization history, functional status, homebound justification, and skilled need explanation.

Explicitly reference in your analysis:
- Initial OASIS and POC vs. current
- F2F and physician order
- Current SN notes and vitals
- Doctor/SOAP/specialist notes
- Labs, imaging, referrals
- Medication changes with diagnosis linkage
- Any changes within the latest 60-day episode and within 14 days after that episode when they affect recertification support.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { documents, maxIterations } = body ?? {};
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Allow tests to inject a stub AI gateway endpoint
    const AI_GATEWAY_URL =
      Deno.env.get("AI_GATEWAY_URL") ??
      "https://ai.gateway.lovable.dev/v1/chat/completions";

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the user message from all documents
    const docSections = documents
      .map(
        (d: { category: string; name: string; text: string }, i: number) =>
          `--- DOCUMENT ${i + 1} ---\nCategory: ${d.category}\nFile: ${d.name}\n\n${d.text}\n`
      )
      .join("\n");

    const userMessage = `Analyze the following recertification packet documents. Compare the initial/first episode documents against the most recent 60-day episode documents. Produce a complete PCR recertification review with detailed analysis, patient summary, red flags, medication changes, and source mapping:\n\n${docSections}`;

    const toolDefinition = {
      type: "function",
      function: {
        name: "pcr_analysis",
        description:
          "Return the complete PCR recertification analysis with all required sections including episode comparison, patient summary, and medication tracking.",
        parameters: {
          type: "object",
          properties: {
            recertificationAnalysis: { type: "string", description: "Detailed explanation of why the patient still qualifies for skilled home health, comparing initial certification to the most recent episode." },
            chartStorySummary: { type: "string", description: "Detailed chart-story style narrative with dates, source names, diagnosis-to-medication linkage, and specific changes over time." },
            patientSummary: { type: "string", description: "Concise patient summary in detailed clinical narrative style with demographics, diagnoses, hospitalizations, medications-to-diagnosis linkage, functional status, homebound and skilled need justification." },
            significantPastHealthHistory: { type: "string", description: "Audit-defensible 'Significant Past Health History' formatted EXACTLY as the 4 paragraphs from STEP 4 (Core Diagnoses & Major History; Comorbidities; Clinical Course & Changes Since Last OASIS; Functional Impact & Skilled Need Drivers). HIPAA-safe." },
            redFlags: {
              type: "array",
              description: "Mismatches, missing elements, contradictions, or concerns affecting PCR approval.",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["category", "description", "severity"],
                additionalProperties: false,
              },
            },
            medicationChanges: {
              type: "array",
              description: "All medication changes with diagnosis linkage.",
              items: {
                type: "object",
                properties: {
                  medication: { type: "string" },
                  changeType: { type: "string", enum: ["new", "discontinued", "dose_change", "frequency_change", "route_change"] },
                  details: { type: "string" },
                  linkedDiagnosis: { type: "string" },
                  sourceDocument: { type: "string" },
                },
                required: ["medication", "changeType", "details", "linkedDiagnosis", "sourceDocument"],
                additionalProperties: false,
              },
            },
            sourceTable: {
              type: "array",
              description: "Source-to-documentation table for each major finding.",
              items: {
                type: "object",
                properties: {
                  finding: { type: "string" },
                  sourceDocument: { type: "string" },
                  date: { type: "string" },
                  category: { type: "string" },
                },
                required: ["finding", "sourceDocument", "date", "category"],
                additionalProperties: false,
              },
            },
            patientIdentifier: { type: "string", description: "HIPAA-safe filename identifier (initials only or 'Unknown_Pt')." },
            episodeRange: { type: "string", description: "Episode date range as 'YYYY-MM-DD_to_YYYY-MM-DD' or 'Episode_Unknown'." },
            auditPass: { type: "boolean", description: "Result of STEP 6 audit. MUST be true on the final returned payload." },
            auditFailures: {
              type: "array",
              description: "Failed STEP 6 criteria (a)–(j). Empty when auditPass is true.",
              items: {
                type: "object",
                properties: {
                  criterion: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["criterion", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "recertificationAnalysis",
            "chartStorySummary",
            "patientSummary",
            "significantPastHealthHistory",
            "redFlags",
            "medicationChanges",
            "sourceTable",
            "patientIdentifier",
            "episodeRange",
            "auditPass",
            "auditFailures",
          ],
          additionalProperties: false,
        },
      },
    };

    // Conversation history — grows across audit-retry iterations
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    // Allow caller to override the audit retry budget. Clamp to [1, 10].
    const requestedMax =
      typeof maxIterations === "number" && Number.isFinite(maxIterations)
        ? Math.floor(maxIterations)
        : 3;
    const MAX_AUDIT_ITERATIONS = Math.max(1, Math.min(10, requestedMax));
    let analysisResult: any = null;
    let lastAuditFailures: Array<{ criterion: string; reason: string }> = [];
    let iterationsRun = 0;

    for (let iteration = 1; iteration <= MAX_AUDIT_ITERATIONS; iteration++) {
      iterationsRun = iteration;
      console.log(`pcr-analyze: audit iteration ${iteration}/${MAX_AUDIT_ITERATIONS}`);

      const response = await fetch(
        AI_GATEWAY_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages,
            tools: [toolDefinition],
            tool_choice: { type: "function", function: { name: "pcr_analysis" } },
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        return new Response(
          JSON.stringify({ error: "AI analysis failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        return new Response(
          JSON.stringify({ error: "AI did not return structured analysis" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      analysisResult = JSON.parse(toolCall.function.arguments);
      lastAuditFailures = Array.isArray(analysisResult.auditFailures)
        ? analysisResult.auditFailures
        : [];

      console.log(
        `pcr-analyze: iteration ${iteration} → auditPass=${analysisResult.auditPass}, failures=${lastAuditFailures.length}`
      );

      if (analysisResult.auditPass === true && lastAuditFailures.length === 0) {
        break;
      }

      if (iteration < MAX_AUDIT_ITERATIONS) {
        const failureSummary =
          lastAuditFailures.length > 0
            ? lastAuditFailures.map((f) => `  - (${f.criterion}) ${f.reason}`).join("\n")
            : "  - auditPass was not true; identify and fix all STEP 6 criteria failures.";

        messages.push({
          role: "assistant",
          content: `Prior draft (iteration ${iteration}) failed STEP 6 audit. auditPass=${analysisResult.auditPass}.`,
        });
        messages.push({
          role: "user",
          content:
            `Revise to pass all audit criteria. The following STEP 6 failures were reported:\n${failureSummary}\n\n` +
            `Return to STEP 4 (NARRATIVE SYNTHESIS) and STEP 5 (DELIVERABLE COMPOSITION), correct each failure, then re-run STEP 6. ` +
            `Do not return until auditPass == true and auditFailures == []. Preserve previously correct content; revise only what is non-compliant.`,
        });
      }
    }

    if (analysisResult) {
      analysisResult._auditMeta = {
        iterations: iterationsRun,
        maxIterations: MAX_AUDIT_ITERATIONS,
        finalAuditPass: analysisResult.auditPass === true && lastAuditFailures.length === 0,
        remainingFailures: lastAuditFailures,
      };
    }

    return new Response(JSON.stringify(analysisResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pcr-analyze error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
