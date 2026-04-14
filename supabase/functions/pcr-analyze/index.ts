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
4. Produce BOTH a detailed recertification analysis AND a concise patient summary.

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
                  },
                  required: [
                    "recertificationAnalysis",
                    "chartStorySummary",
                    "patientSummary",
                    "redFlags",
                    "medicationChanges",
                    "sourceTable",
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

    const analysisResult = JSON.parse(toolCall.function.arguments);

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
