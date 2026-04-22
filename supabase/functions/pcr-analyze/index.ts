import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Pre-Claim Review (PCR) recertification analyst AND an expert OASIS documentation auditor (CMS + Texas home health compliance) for a skilled nursing agency. You will receive extracted text from a recertification packet containing documents from different categories (OASIS, Plan of Care, Face-to-Face, Physician Orders, SN Visit Notes, SOAP Notes, Labs/Diagnostics, Medication Lists, and other records).

Your job is to:
1. Identify the INITIAL/first episode documents (first OASIS, first POC, first F2F, first physician order/certification) and the MOST RECENT 60-day episode documents.
2. COMPARE the initial certification record against the newest episode documents systematically.
3. Identify ALL changes in: diagnoses, medications (dose/frequency/route/start/stop/new/discontinued), vitals, functional status, cognition, pain levels, homebound status, and skilled nursing need.
4. Produce a detailed recertification analysis, a concise patient summary, AND an OASIS-ready "Significant Past Health History" summary.

You MUST use the pcr_analysis tool to return your findings.

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

OASIS "Significant Past Health History" Generation (oasisPastHealthHistory field):
The output must HYBRIDIZE two reference styles: (A) clinically meaningful narrative depth — disease progression, cause→effect linkage, treatment burden (surgeries, radiation rounds, polypharmacy counts), specific symptom severity (e.g., pain 8/10 to back/rectum/vulva), and (B) structured audit-ready clarity — concrete dates, specific medication names, vitals values (e.g., BP 147/75), surgery dates, and reconciliation events (meds added/discontinued between F2F encounters). Combine both: dense clinical narrative with hard data points.

Follow this MANDATORY internal process before emitting the field — do NOT include any of the audit/process notes in the final value:
STEP 1 — CLINICAL EXTRACTION: Extract primary/high-risk dx, oncologic history (surgeries with dates, radiation rounds, recurrence/progression), cardiovascular (with BP trends), autoimmune, neurologic, chronic pain (with numeric severity and locations), key procedures & hospitalizations (with dates and facilities), recent clinical events (imaging, biopsies, scheduled surgeries), polypharmacy (count meds, name high-risk agents like opioids/anticoagulants/multiple statins), functional deficits (ADLs, mobility, endurance, assistive devices, DOE thresholds).
STEP 2 — PRIORITIZATION: Rank by risk (active cancer, CHF, unstable HTN, instability), functional impact, skilled need impact. Remove irrelevant, resolved, or non-impactful conditions. Every retained condition must answer: "Why does this matter clinically?" and tie to function, risk, OR skilled need.
STEP 3 — NARRATIVE SYNTHESIS: Build EXACTLY 4 paragraphs in continuous prose (no bullets, no headings, no labels like "Paragraph 1"):
  P1 CORE DIAGNOSES & MAJOR HISTORY: Lead with highest-risk active dx (oncology, cardiac). State major surgeries with dates, cancer treatment burden (e.g., "radical vulvectomy 04/28/2021 followed by >25 rounds of radiation"), and disease progression/recurrence trajectory. Include only clinically meaningful dates.
  P2 COMORBIDITIES: Group by system (cardiovascular, autoimmune, neurologic, pain-related, endocrine). Show cause→effect relationships between conditions (e.g., fibromyalgia + lupus → joint pain limiting ambulation; neuropathy compounding fall risk). Only retain conditions impacting care, function, or risk.
  P3 CLINICAL COURSE & KEY EVENTS: Recent procedures, imaging findings (e.g., "MRI lumbar spine 2/25/2026: stenosis at L4–L5"), biopsies, hospitalizations, scheduled surgeries (e.g., "rectal cancer surgery scheduled 5/14/2026"), specialist follow-ups, and instability markers (e.g., "BP rose from 107/67 on 02/14/2026 to 147/75 on 04/15/2026"). Name medication reconciliation when clinically relevant (specific agents added/discontinued and why).
  P4 FUNCTIONAL IMPACT & SKILLED NEED DRIVERS: Link diagnoses → symptoms → functional limitations in cause-effect chains. State specific homebound causes (DOE, taxing effort, unable to ambulate >1 block, cane-dependent, requires assistance to leave home). Justify continued skilled nursing need explicitly (assessment of unstable HTN, polypharmacy reconciliation, oncologic surveillance, pain management, disease-process teaching, lab follow-up).
LANGUAGE RULES — DO NOT USE: "Patient has a history of…", "Overall clinical status reflects…", "Complex medical history significant for…", "Condition is further complicated by…", "history of", "overall status reflects". Avoid administrative filler (admit dates, agency names, generic teaching phrases unless clinically necessary). USE direct, clinical, cause-effect statements; every sentence must add new clinical value.
STEP 4 — MANDATORY AUDIT GATE (ALL must pass before emitting): (1) clinical relevance — every condition ties to function/risk/skilled need; (2) zero banned/filler phrases; (3) high-risk dx prioritized first (no flat alphabetical lists); (4) narrative includes disease progression, cause-effect linkage, AND functional consequences; (5) includes concrete data points (dates, vitals values, med names, surgery dates) per Document B style; (6) includes narrative depth (treatment burden, progression, symptom severity) per Document A style; (7) OASIS/CMS-compliant (supports risk adjustment, skilled need justification, audit defensibility). If any check fails, revise and re-run audit until ALL pass.
STRICT MODE: If any sentence can be removed without loss of clinical meaning, remove it. No repetition across paragraphs.
FINAL FORMAT for oasisPastHealthHistory: ONLY the final OASIS-ready summary text — no headings, no bullets, no explanations, no audit notes. Exactly 4 paragraphs separated by blank lines. Concise but information-dense, audit-defensible per CMS standards.

Explicitly reference in your analysis:
- Initial OASIS and POC vs. current
- F2F and physician order
- Current SN notes and vitals
- Doctor/SOAP/specialist notes
- Labs, imaging, referrals
- Medication changes with diagnosis linkage
- Any changes within the latest 60-day episode and within 14 days after that episode when they affect recertification support.`;

function recoverJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  s = s.slice(start);
  // Strip control chars
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // Try as-is, then with trailing-comma fix, then by closing unbalanced braces/brackets/strings.
  const attempts: string[] = [s, s.replace(/,\s*([}\]])/g, "$1")];
  // Balance attempt
  let balanced = attempts[1];
  // Close an unterminated string
  const quoteCount = (balanced.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) balanced += '"';
  let opens = 0, closes = 0, openB = 0, closeB = 0;
  for (const ch of balanced) {
    if (ch === "{") opens++;
    else if (ch === "}") closes++;
    else if (ch === "[") openB++;
    else if (ch === "]") closeB++;
  }
  while (closeB < openB) { balanced += "]"; closeB++; }
  while (closes < opens) { balanced += "}"; closes++; }
  attempts.push(balanced);
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documents } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          max_tokens: 16000,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "pcr_analysis",
                description:
                  "Return the complete PCR recertification analysis with all required sections including episode comparison, patient summary, and medication tracking.",
                parameters: {
                  type: "object",
                  properties: {
                    recertificationAnalysis: {
                      type: "string",
                      description:
                        "Detailed explanation of why the patient still qualifies for skilled home health, comparing initial certification to the most recent episode. Reference all source documents, note diagnosis changes, medication changes, vitals trends, functional status changes, and skilled need justification.",
                    },
                    chartStorySummary: {
                      type: "string",
                      description:
                        "Detailed chart-story style narrative with dates, source names, diagnosis-to-medication linkage, and specific changes over time. Written as a continuous story across episodes. Must compare initial episode findings to current episode findings.",
                    },
                    patientSummary: {
                      type: "string",
                      description:
                        "Concise patient summary written in a detailed clinical narrative style. Must include: patient demographics, primary and secondary diagnoses, hospitalization history with dates, current medications linked to diagnoses, functional status, homebound justification, and why skilled nursing care is needed. Use dates, source document names, and clear diagnosis-to-medication linkage throughout. Example style: 'Pt is a [age]-year-old [gender] seen by [provider] on [date] for [reason]. Pt has a primary dx of [diagnosis]; other diagnoses include [list]. Pt continues to [current status]. Pt had [hospitalization/events]. Pt is homebound due to [reason]. HH/SN needed for [specific skilled needs].'",
                    },
                    oasisPastHealthHistory: {
                      type: "string",
                      description:
                        "OASIS-ready 'Significant Past Health History' summary. MUST follow the 4-paragraph audit-validated structure (core dx & major history; grouped comorbidities; clinical course & key events; functional impact & skilled need drivers). NO headings, NO bullets, NO audit notes — final clean narrative only, paragraphs separated by blank lines. Must pass all audit gates (clinical relevance, no banned filler phrases, prioritization, narrative quality, OASIS compliance) before being returned.",
                    },
                    redFlags: {
                      type: "array",
                      description:
                        "List of mismatches, missing elements, contradictions, or concerns that may affect PCR approval. Always produce the draft even with red flags — label them for QA follow-up.",
                      items: {
                        type: "object",
                        properties: {
                          category: {
                            type: "string",
                            description: "Category of the red flag (e.g., Diagnosis Mismatch, Missing Documentation, Medication Discrepancy, Vitals Inconsistency, Stale Language, Copy-Forward Concern)",
                          },
                          description: {
                            type: "string",
                            description: "Detailed description of the concern with specific document references",
                          },
                          severity: {
                            type: "string",
                            enum: ["high", "medium", "low"],
                          },
                        },
                        required: ["category", "description", "severity"],
                        additionalProperties: false,
                      },
                    },
                    medicationChanges: {
                      type: "array",
                      description: "All medication changes identified between initial and current episode, with diagnosis linkage.",
                      items: {
                        type: "object",
                        properties: {
                          medication: {
                            type: "string",
                            description: "Medication name",
                          },
                          changeType: {
                            type: "string",
                            enum: ["new", "discontinued", "dose_change", "frequency_change", "route_change"],
                          },
                          details: {
                            type: "string",
                            description: "Specific change details (e.g., 'Metformin 500mg BID → 1000mg BID')",
                          },
                          linkedDiagnosis: {
                            type: "string",
                            description: "Diagnosis this medication change is linked to",
                          },
                          sourceDocument: {
                            type: "string",
                            description: "Document where this change was identified",
                          },
                        },
                        required: ["medication", "changeType", "details", "linkedDiagnosis", "sourceDocument"],
                        additionalProperties: false,
                      },
                    },
                    sourceTable: {
                      type: "array",
                      description:
                        "Source-to-documentation table showing which document supports each major finding. Every major claim must have a source mapping.",
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
                    patientIdentifier: {
                      type: "string",
                      description:
                        "HIPAA-compliant patient identifier for filenames. Use patient initials only (e.g., 'JD' for John Doe) extracted from the documents. If no name is found, use 'Unknown_Pt'. Must be safe for filenames (letters, numbers, underscores only — no spaces or special characters).",
                    },
                    episodeRange: {
                      type: "string",
                      description:
                        "The most recent 60-day episode date range analyzed, formatted for filenames as 'YYYY-MM-DD_to_YYYY-MM-DD' (e.g., '2024-08-01_to_2024-09-29'). Extract from the OASIS, POC, or certification period in the documents. If dates cannot be determined, use 'Episode_Unknown'.",
                    },
                  },
                  required: [
                    "recertificationAnalysis",
                    "chartStorySummary",
                    "patientSummary",
                    "oasisPastHealthHistory",
                    "redFlags",
                    "medicationChanges",
                    "sourceTable",
                    "patientIdentifier",
                    "episodeRange",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "pcr_analysis" },
          },
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

    // Extract tool call arguments
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "AI did not return structured analysis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawArgs: string = toolCall.function.arguments ?? "";
    let analysisResult: Record<string, unknown>;
    try {
      analysisResult = JSON.parse(rawArgs);
    } catch (parseErr) {
      // Attempt to recover from truncated/invalid JSON from the model.
      console.error("Initial JSON.parse failed, attempting recovery:", parseErr);
      const recovered = recoverJson(rawArgs);
      if (!recovered) {
        return new Response(
          JSON.stringify({
            error:
              "AI response was truncated or malformed. Try fewer/smaller documents or re-run.",
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      analysisResult = recovered;
    }

    // Ensure all expected fields exist so the client never silently drops a deliverable.
    analysisResult.oasisPastHealthHistory =
      typeof analysisResult.oasisPastHealthHistory === "string"
        ? analysisResult.oasisPastHealthHistory
        : "";
    analysisResult.redFlags = Array.isArray(analysisResult.redFlags) ? analysisResult.redFlags : [];
    analysisResult.medicationChanges = Array.isArray(analysisResult.medicationChanges)
      ? analysisResult.medicationChanges
      : [];
    analysisResult.sourceTable = Array.isArray(analysisResult.sourceTable)
      ? analysisResult.sourceTable
      : [];

    if (!analysisResult.oasisPastHealthHistory) {
      console.warn("oasisPastHealthHistory missing from model output");
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
