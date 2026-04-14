import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Pre-Claim Review (PCR) recertification analyst for a skilled nursing agency. You will receive extracted text from a recertification packet containing documents from different categories (OASIS, Plan of Care, Face-to-Face, Physician Orders, SN Visit Notes, SOAP Notes, Labs/Diagnostics, Medication Lists, and other records).

Your job is to analyze ALL documents, compare the initial certification to the most recent episode, and produce a structured analysis. You MUST use the pcr_analysis tool to return your findings.

Rules:
- De-identify the patient (use "Pt" or initials only). Comply with HIPAA.
- Do NOT invent facts. Do NOT omit contradictions.
- Do NOT use unsupported copy-forward language.
- The tone must be clinical, specific, and detailed.
- Write the chart story as a continuous narrative across episodes with dates, source names, diagnosis-to-medication linkage, and specific changes over time.
- If any mismatch or concern is found, flag it clearly but still generate the draft analysis.
- Explicitly reference: Initial OASIS and POC, F2F and physician order, Current SN notes, Doctor/SOAP/specialist notes, Labs/imaging/referrals, Medication changes, and any changes within the latest 60-day episode.`;

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

    const userMessage = `Analyze the following recertification packet documents and produce a complete PCR recertification review:\n\n${docSections}`;

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
                  "Return the complete PCR recertification analysis with all required sections.",
                parameters: {
                  type: "object",
                  properties: {
                    recertificationAnalysis: {
                      type: "string",
                      description:
                        "Detailed explanation of why the patient still qualifies for skilled home health, referencing all source documents.",
                    },
                    chartStorySummary: {
                      type: "string",
                      description:
                        "Detailed chart-story style narrative with dates, source names, diagnosis-to-medication linkage, and specific changes over time. Written as a continuous story across episodes.",
                    },
                    redFlags: {
                      type: "array",
                      description:
                        "List of mismatches, missing elements, or concerns that may prevent a clean PCR review.",
                      items: {
                        type: "object",
                        properties: {
                          category: {
                            type: "string",
                            description: "Category of the red flag (e.g., Diagnosis Mismatch, Missing Documentation, Medication Discrepancy)",
                          },
                          description: {
                            type: "string",
                            description: "Detailed description of the concern",
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
                    sourceTable: {
                      type: "array",
                      description:
                        "Source-to-documentation table showing which document supports each major finding.",
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
                    "redFlags",
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
      // Fallback: try to use content directly
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
