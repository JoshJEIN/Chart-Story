// Start-of-Care (Admission) Clinical Analyzer
// Mirrors the structure & guardrails of pcr-analyze (audit loop, payload caps,
// tool-calling JSON contract, health probe) but produces a forward-looking
// admission care plan + first SN visit note + patient/caregiver education plan.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home-health Start-of-Care admission clinical planning analyst for a Texas agency.

Return ONLY by calling the soc_analysis tool. Use only documented facts from the supplied packet. Never invent diagnoses, dates, meds, vitals, orders, F2F details, or functional limits. If required evidence is missing, write "[NOT DOCUMENTED]" and add a red flag.

Produce these admission deliverables: (1) admission clinical picture and baseline, (2) 485-aligned plan of care with diagnoses, homebound justification, skilled need, timed measurable goals, orders, DME/supplies, (3) first SN visit SOAP-style template, (4) patient/caregiver education with teach-back.

Internal workflow: extract key facts with sources; prioritize life-threatening/decompensation-prone/skilled-need-driving/functionally-impactful issues first; project admission risks and needed SN interventions; then write concise deliverables.

Narratives: admissionChartStory and significantPastHealthHistory must each be EXACTLY 4 paragraphs in this order: reason for admission/core diagnoses; comorbidity clusters and consequences; admission clinical picture with dated events and risks; functional impact/homebound drivers/skilled nursing need. Use "Pt"/initials only in narratives. patientFullName may contain the real name only for filename labeling.

Compliance rules: every major condition must include a clinical consequence; goals must be objective and timed; homebound/skilled need must cite specific clinical drivers and SN interventions; F2F must be referenced or flagged missing; med/POC/diagnosis mismatches must be in medicationReconciliation or redFlags; education fullExplanation must be chart-ready teaching content with warning signs, diet/med guidance, and 2-4 teach-back questions.

Keep output timeout-safe: max 4 education topics, 6 goals, 8 first-visit interventions, 10 red flags, 15 source rows. Be complete but concise. Set auditPass true only if criteria pass; otherwise include exact auditFailures.`;

const CLINICAL_KEYWORDS = [
  "admission", "assessment", "diagnosis", "dx", "problem", "vital", "blood pressure", "pulse", "spo2", "respiration",
  "temperature", "weight", "pain", "medication", "allerg", "order", "frequency", "duration", "plan", "goal", "intervention",
  "skilled", "nursing", "homebound", "face to face", "f2f", "oasis", "485", "poc", "copd", "hypertension", "diabetes",
  "chf", "ckd", "wound", "fall", "gait", "ambulat", "transfer", "adl", "iadl", "caregiver", "environment", "safety",
  "lab", "imaging", "hospital", "discharge", "ed visit", "shortness", "dyspnea", "edema", "lung", "oxygen", "nebulizer",
];

function compactClinicalText(rawText: string, maxChars: number): string {
  const text = rawText.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (text.length <= maxChars) return text;

  const lead = text.slice(0, Math.min(5_000, Math.floor(maxChars * 0.25)));
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const seen = new Set<string>();
  const budget = maxChars - lead.length - 400;
  let used = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!CLINICAL_KEYWORDS.some((keyword) => lower.includes(keyword))) continue;
    const key = lower.slice(0, 220);
    if (seen.has(key)) continue;
    if (used + line.length + 1 > budget) break;
    seen.add(key);
    kept.push(line);
    used += line.length + 1;
  }

  return `${lead}\n\n[DOCUMENT COMPACTED FOR TIMEOUT PREVENTION — retained beginning plus high-yield clinical lines.]\n${kept.join("\n")}`.slice(0, maxChars);
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Lightweight health probe
  const url = new URL(req.url);
  let isHealthCheck =
    url.pathname.endsWith("/health") ||
    url.searchParams.get("health") === "1" ||
    req.headers.get("x-health-check") === "1";

  const MAX_PAYLOAD_BYTES = 9 * 1024 * 1024;

  let rawBody = "";
  if (!isHealthCheck && req.method === "POST") {
    const contentLengthHeader = req.headers.get("content-length");
    if (contentLengthHeader) {
      const declared = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
        return new Response(
          JSON.stringify({
            error: `Payload too large (${(declared / 1024 / 1024).toFixed(1)} MB). The maximum is ${(MAX_PAYLOAD_BYTES / 1024 / 1024).toFixed(0)} MB. Analyze fewer or smaller documents per run.`,
          }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    try {
      rawBody = await req.text();
    } catch (readErr) {
      console.error("soc-analyze: failed to read request body", readErr);
      return new Response(
        JSON.stringify({ error: "Failed to read request body. Try again with fewer documents." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return new Response(
        JSON.stringify({
          error: `Payload exceeded the ${(MAX_PAYLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json") && rawBody.length > 0 && rawBody.length < 256) {
      try {
        const peek = JSON.parse(rawBody);
        if (peek && (peek.health === 1 || peek.health === "1" || peek.health === true)) {
          isHealthCheck = true;
        }
      } catch { /* ignore */ }
    }
  }

  if (isHealthCheck) {
    return new Response(
      JSON.stringify({
        status: "ok",
        function: "soc-analyze",
        hasApiKey: Boolean(Deno.env.get("LOVABLE_API_KEY")),
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const PER_DOC_CHAR_CAP = 18_000;
    const TOTAL_DOC_CHAR_CAP = 90_000;

    if (!rawBody || rawBody.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Empty request body received." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error("soc-analyze: failed to parse JSON", parseErr);
      return new Response(
        JSON.stringify({ error: "Request body was not valid JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { documents: rawDocuments, maxIterations } = body ?? {};

    let documents = rawDocuments;
    if (Array.isArray(rawDocuments)) {
      let runningTotal = 0;
      documents = rawDocuments.map((d: any) => {
        if (!d || typeof d.text !== "string") return d;
        let text = compactClinicalText(d.text, PER_DOC_CHAR_CAP);
        let truncated = false;
        if (text.length > PER_DOC_CHAR_CAP) {
          text = text.slice(0, PER_DOC_CHAR_CAP);
          truncated = true;
        }
        const remaining = TOTAL_DOC_CHAR_CAP - runningTotal;
        if (remaining <= 0) {
          text = "";
          truncated = true;
        } else if (text.length > remaining) {
          text = text.slice(0, remaining);
          truncated = true;
        }
        runningTotal += text.length;
        if (truncated) {
          text += "\n\n[TEXT TRUNCATED BY SERVER PAYLOAD LIMIT — analyze remaining content; surface a red flag if critical sections were cut.]";
        }
        return { ...d, text };
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const AI_GATEWAY_URL =
      Deno.env.get("AI_GATEWAY_URL") ??
      "https://ai.gateway.lovable.dev/v1/chat/completions";

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const MIN_USEFUL_CHARS = 200;
    const usableDocs = (documents as Array<{ category: string; name: string; text: string }>)
      .filter((d) => typeof d.text === "string" && d.text.trim().length >= MIN_USEFUL_CHARS);

    if (usableDocs.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Uploaded documents contained no extractable clinical text. Re-upload text-based PDFs, DOCX, TXT, or CSV exports — scanned/image PDFs require OCR before analysis.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const docSections = usableDocs
      .map(
        (d, i) =>
          `--- DOCUMENT ${i + 1} ---\nCategory: ${d.category}\nFile: ${d.name}\n\n${d.text}\n`
      )
      .join("\n");

    const userMessage = `Analyze the following ADMISSION / Start-of-Care packet. Build a Medicare-compliant admission care plan, first SN visit note template, and patient/caregiver education plan from these documents.\n\nCRITICAL GROUNDING RULES:\n- Use ONLY facts that appear verbatim or are directly inferable from the document text below.\n- Every diagnosis, medication, date, lab value, and historical item MUST be traceable to a specific DOCUMENT N / File: <name>.\n- If a required field cannot be supported by the source text, write "[NOT DOCUMENTED]" and surface a red flag — do NOT fabricate, do NOT use prior knowledge of typical home-health patients.\n- Patient identifier must be derived from the actual document text or filenames provided; if absent use "Unknown_Pt".\n\nTIMEOUT-SAFE OUTPUT LIMITS:\n- Be complete but concise: max 4 education topics, max 6 goals, max 8 planned interventions, max 10 red flags, and max 15 source-table rows.\n- Prioritize high-risk diagnoses, medications, vitals, functional limits, homebound drivers, and skilled-need evidence.\n- Do not repeat the same source citation in every sentence; use sourceTable for traceability.\n\nDOCUMENTS:\n\n${docSections}`;

    const toolDefinition = {
      type: "function",
      function: {
        name: "soc_analysis",
        description:
          "Return the complete Start-of-Care admission analysis: admission narrative, 485-aligned plan of care, first SN visit note template, and patient/caregiver education plan.",
        parameters: {
          type: "object",
          properties: {
            patientIdentifier: { type: "string", description: "HIPAA-safe identifier (initials only or 'Unknown_Pt') used in narrative." },
            patientFullName: { type: "string", description: "Real full name from chart for filename labeling ONLY. Empty string if not found." },
            episodeInfo: {
              type: "object",
              properties: {
                episodeType: { type: "string", description: "e.g. 'Start of Care'." },
                certPeriodDates: { type: "string", description: "Cert period date range from OASIS/POC, or '[DATES NOT DOCUMENTED]'." },
                episodeLabel: { type: "string", description: "e.g. 'Episode 1, Cert Period 1 (SOC)'." },
              },
              required: ["episodeType", "certPeriodDates", "episodeLabel"],
              additionalProperties: false,
            },
            admissionChartStory: { type: "string", description: "4-paragraph narrative per STEP 4: reason for admission & core dx; comorbidities; admission clinical picture & drivers; functional impact, homebound status & skilled need." },
            significantPastHealthHistory: { type: "string", description: "Audit-defensible 'Significant Past Health History' — the same 4 paragraphs from STEP 4, framed for OASIS SOC documentation." },
            planOfCare: {
              type: "object",
              properties: {
                primaryDx: { type: "string" },
                secondaryDx: { type: "array", items: { type: "string" } },
                homeboundJustification: { type: "string", description: "Specific clinical drivers — never generic." },
                skilledNeedRationale: { type: "string", description: "Names specific SN interventions tied to documented diagnoses." },
                measurableGoals: {
                  type: "array",
                  description: "Each goal MUST be objective AND timed.",
                  items: { type: "string" },
                },
                disciplineOrders: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      discipline: { type: "string", description: "SN, PT, OT, ST, MSW, HHA." },
                      frequencyDuration: { type: "string", description: "e.g. 'SN 3W2 x 4 weeks then 2W1 x 5 weeks'." },
                      interventions: { type: "string", description: "Specific interventions ordered." },
                    },
                    required: ["discipline", "frequencyDuration", "interventions"],
                    additionalProperties: false,
                  },
                },
                dmeSupplies: { type: "string", description: "DME and supplies referenced in chart, or '[NEEDS CLARIFICATION]'." },
              },
              required: ["primaryDx", "secondaryDx", "homeboundJustification", "skilledNeedRationale", "measurableGoals", "disciplineOrders", "dmeSupplies"],
              additionalProperties: false,
            },
            firstSnVisitNote: {
              type: "object",
              properties: {
                subjective: { type: "string" },
                objectiveFocus: { type: "array", items: { type: "string" } },
                assessment: { type: "string" },
                plannedInterventions: { type: "array", items: { type: "string" } },
                teachingTopics: { type: "array", items: { type: "string" } },
                safetyChecks: { type: "array", items: { type: "string" } },
                skilledJustification: { type: "string" },
              },
              required: ["subjective", "objectiveFocus", "assessment", "plannedInterventions", "teachingTopics", "safetyChecks", "skilledJustification"],
              additionalProperties: false,
            },
            educationPlan: {
              type: "array",
              description: "Patient/caregiver education topics with FULL teach-back narratives — never one-line topic labels.",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  linkedDiagnosisOrMed: { type: "string" },
                  whyItMatters: { type: "string" },
                  fullExplanation: { type: "string", description: "Chart-ready teaching narrative — what the disease/med IS, how it works, what to do." },
                  signsToWatch: { type: "array", items: { type: "string" } },
                  dietaryGuidance: { type: "string" },
                  medGuidance: { type: "string" },
                  teachBackQuestions: { type: "array", items: { type: "string" }, description: "2-4 teach-back questions." },
                },
                required: ["topic", "linkedDiagnosisOrMed", "whyItMatters", "fullExplanation", "signsToWatch", "dietaryGuidance", "medGuidance", "teachBackQuestions"],
                additionalProperties: false,
              },
            },
            redFlags: {
              type: "array",
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
            medicationReconciliation: {
              type: "array",
              description: "Mismatches between med list, POC orders, and admission diagnoses. Empty array if none.",
              items: {
                type: "object",
                properties: {
                  medication: { type: "string" },
                  issue: { type: "string", description: "Mismatch description." },
                  recommendation: { type: "string" },
                  sourceDocument: { type: "string" },
                },
                required: ["medication", "issue", "recommendation", "sourceDocument"],
                additionalProperties: false,
              },
            },
            sourceTable: {
              type: "array",
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
            auditPass: { type: "boolean" },
            auditFailures: {
              type: "array",
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
            "patientIdentifier",
            "patientFullName",
            "episodeInfo",
            "admissionChartStory",
            "significantPastHealthHistory",
            "planOfCare",
            "firstSnVisitNote",
            "educationPlan",
            "redFlags",
            "medicationReconciliation",
            "sourceTable",
            "auditPass",
            "auditFailures",
          ],
          additionalProperties: false,
        },
      },
    };

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const requestedMax =
      typeof maxIterations === "number" && Number.isFinite(maxIterations)
        ? Math.floor(maxIterations)
        : 1;
    const MAX_AUDIT_ITERATIONS = Math.max(1, Math.min(2, requestedMax));
    const AI_REQUEST_TIMEOUT_MS = 75_000;
    let analysisResult: any = null;
    let lastAuditFailures: Array<{ criterion: string; reason: string }> = [];
    let iterationsRun = 0;

    for (let iteration = 1; iteration <= MAX_AUDIT_ITERATIONS; iteration++) {
      iterationsRun = iteration;
      console.log(`soc-analyze: audit iteration ${iteration}/${MAX_AUDIT_ITERATIONS}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages,
            tools: [toolDefinition],
            tool_choice: { type: "function", function: { name: "soc_analysis" } },
          }),
        });
      } catch (fetchErr) {
        if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
          return new Response(
            JSON.stringify({ error: "Admission analysis timed out while generating. Try fewer or shorter documents." }),
            { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

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
      const message = data.choices?.[0]?.message;
      const toolCall = message?.tool_calls?.[0];
      let rawArgs: string | undefined = toolCall?.function?.arguments;

      // Fallback: some models return JSON in content instead of tool_calls
      if (!rawArgs && typeof message?.content === "string" && message.content.trim()) {
        const content = message.content.trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (match) rawArgs = match[0];
      }

      if (!rawArgs) {
        console.error("AI returned no structured output:", JSON.stringify(data).slice(0, 1000));
        return new Response(
          JSON.stringify({ error: "AI did not return structured analysis" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        analysisResult = JSON.parse(rawArgs);
      } catch (parseErr) {
        console.error("Failed to parse AI JSON:", parseErr, rawArgs.slice(0, 500));
        return new Response(
          JSON.stringify({ error: "AI returned malformed analysis JSON" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      lastAuditFailures = Array.isArray(analysisResult.auditFailures)
        ? analysisResult.auditFailures
        : [];

      console.log(
        `soc-analyze: iteration ${iteration} → auditPass=${analysisResult.auditPass}, failures=${lastAuditFailures.length}`
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
    console.error("soc-analyze error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

Deno.serve(handler);
