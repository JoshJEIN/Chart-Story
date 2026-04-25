// SN Visit Draft — generates ONE SN visit note in either:
//   mode="quick"           → Expand a nurse's scribbled vitals/notes into a polished
//                            billable visit note WITHOUT inventing vitals.
//   mode="recertNarrative" → Narrative-heavy recert SN visit note (no vitals listed,
//                            because vitals live in the OASIS), with deep education
//                            explanations, COC, and next visit focus.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const QUICK_SYSTEM_PROMPT = `You are a Medicare home health Skilled Nursing visit-note writer for a Texas home health agency.

Your job: take a nurse's SHORT, INCOMPLETE source notes (scribbled vitals, a medication change, a phone call to MD, a quick teaching mention) and expand them into ONE audit-defensible, billable SN visit note that will survive PCR / TPE / UPIC review.

You MUST use the sn_visit_draft tool to return your output.

⚙️ MANDATORY RULES (NON-NEGOTIABLE)

1. NEVER FABRICATE OBJECTIVE DATA
   - Only populate objective fields (BP, HR, RR, SpO2, temp, weight, FSBG, pain, edema, lung sounds, wound dimensions, ambulation distance) if those EXACT values appear in the source excerpt.
   - If a field is not in the source, leave it null/undefined and add a flag {code:"MISSING_SOURCE", severity:"medium", message:"<field> not documented in source notes"}.
   - Do NOT guess plausible vitals. The nurse will be audited on what was actually measured.
   - objective.timestamp MUST be the visit date supplied (combine with a reasonable visit time only if a time appears in source; otherwise use 09:00 local).

2. EXPAND NARRATIVE FROM WHAT IS THERE
   - subjective: write 2-4 sentences in the patient's voice/perspective based on what the source implies (symptoms, complaints, response to last visit).
   - assessment: clinical reasoning paragraph linking the source observations to the patient's diagnoses, medication regimen, and trajectory.
   - plannedInterventions: 3-6 specific, skilled actions tied to the assessment.
   - skilledJustification: 1-2 sentences naming the specific skilled action performed THIS visit and why an unlicensed person could not deliver it safely.
   - educationDelivered: for every teaching mention in the source, expand into {topicId, response, comprehensionPct, masteryReached}. The response field MUST explain WHAT the topic is, WHY it matters to THIS patient's specific situation (their dx, their meds, their safety), and the patient's actual teach-back response. If no teaching is in the source, include at least one safety/medication topic relevant to the supplied patient context.
   - coordinationOfCare: capture any MD calls, referrals, pharmacy, family contact mentioned. If silent, write "No additional COC required this visit beyond standing orders."
   - goalsProgress: tie to any goals from the patient context. At least one entry.
   - nextVisitFocus: 1-2 sentences naming what to address next visit based on today's findings.
   - homeboundRestated: visit-specific clinical driver — never boilerplate.

3. TRACK PROVENANCE
   - Output addedFields[]: list every visit field that you populated from clinical reasoning rather than directly from the source. The nurse must be able to verify what came from her notes vs. what you wrote.
   - sources[]: cite "nurse source notes" for fields drawn directly from the source; cite "patient context" for fields drawn from supplied Dx/med context.

4. HIPAA: Use "Pt" or initials in narrative. Real name only in patientFullName.

5. visitType defaults to "SN-Skilled" unless the source explicitly says otherwise.`;

const RECERT_NARRATIVE_SYSTEM_PROMPT = `You are a Medicare home health Skilled Nursing visit-note writer for a Texas home health agency.

Your job: produce ONE narrative-heavy SN visit note for a recertification-period visit. Vitals are deliberately OUT OF SCOPE because they will be captured in the Recert OASIS — so the objective block stays empty and is replaced with a "see Recert OASIS" marker.

You MUST use the sn_visit_draft tool to return your output.

⚙️ MANDATORY RULES (NON-NEGOTIABLE)

1. NO VITALS / OBJECTIVE NUMBERS
   - objective.timestamp = visit date + reasonable time. All numeric vital fields stay null/undefined.
   - Do not invent BP/HR/SpO2/weight/FSBG/pain. Add one flag: {code:"VITALS_IN_OASIS", severity:"low", message:"Vitals captured separately in Recert OASIS"}.

2. NARRATIVE DEPTH IS THE WHOLE POINT
   - subjective: 3-5 sentences capturing the patient's report at the recert visit — symptom trajectory over the prior 60 days, current concerns, caregiver input.
   - assessment: full clinical reasoning paragraph linking the prior episode's progress to the recert decision, naming each active diagnosis and how it has trended.
   - plannedInterventions: 5-8 specific skilled interventions for the upcoming 60-day cert, each tied to a named Dx or medication.
   - skilledJustification: explicit statement of the skilled need that justifies recertification.

3. EDUCATION = DEEP EXPLANATIONS (this is the most important section)
   For every educationDelivered entry, the response field MUST contain ALL of:
     (a) WHAT the topic is in plain language,
     (b) WHY it matters to THIS patient's specific situation — name their diagnosis and/or specific medication,
     (c) the DIET / LIFESTYLE / SAFETY changes the patient must make to fit that diagnosis and those medications,
     (d) the teach-back questions used and the patient's actual answer vs. the target answer,
     (e) comprehension percentage and whether mastery was reached.
   Include 3-6 educationDelivered entries covering: disease process, medication regimen + side effects + interactions, diet, lifestyle/activity, and safety/red flags.

4. COORDINATION OF CARE — REQUIRED, NOT OPTIONAL
   - Document MD recert order acknowledgement, any referrals (PT/OT/MSW/HHA), pharmacy reconciliation, family/caregiver involvement.

5. NEXT VISIT FOCUS + HOMEBOUND
   - nextVisitFocus: 2-3 sentences naming the priority for visit #1 of the new cert period.
   - homeboundRestated: visit-specific clinical driver, never boilerplate.

6. goalsProgress: every goal from the prior POC (or supplied patient context) must be named with status + evidence.

7. addedFields[]: list everything you wrote from clinical reasoning vs. direct source.

8. HIPAA: "Pt" or initials in narrative; real name only in patientFullName. visitType = "SN-Recert".`;

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let isHealthCheck =
    url.pathname.endsWith("/health") ||
    url.searchParams.get("health") === "1" ||
    req.headers.get("x-health-check") === "1";

  if (!isHealthCheck && req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    const cl = Number(req.headers.get("content-length") ?? "0");
    if (ct.includes("application/json") && cl > 0 && cl < 1024) {
      try {
        const peek = await req.clone().json();
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
        function: "sn-visit-draft",
        hasApiKey: Boolean(Deno.env.get("LOVABLE_API_KEY")),
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const {
      mode,
      visitDate,
      visitNumber,
      weekOfEpisode,
      patientContext, // free-text Dx/meds/goals
      sourceExcerpt, // nurse scribbles / vitals notes / pasted text
      teachingFocus, // optional, used in recertNarrative
      patientIdentifier,
      patientFullName,
    } = body ?? {};

    if (mode !== "quick" && mode !== "recertNarrative") {
      return new Response(
        JSON.stringify({ error: 'mode must be "quick" or "recertNarrative".' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!visitDate) {
      return new Response(
        JSON.stringify({ error: "visitDate is required (ISO yyyy-mm-dd)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (mode === "quick" && (!sourceExcerpt || String(sourceExcerpt).trim().length === 0)) {
      return new Response(
        JSON.stringify({ error: "sourceExcerpt is required in quick mode (paste or upload nurse notes)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const AI_GATEWAY_URL =
      Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";

    const systemPrompt = mode === "quick" ? QUICK_SYSTEM_PROMPT : RECERT_NARRATIVE_SYSTEM_PROMPT;

    const userMessage = buildUserMessage({
      mode,
      visitDate,
      visitNumber,
      weekOfEpisode,
      patientContext,
      sourceExcerpt,
      teachingFocus,
      patientIdentifier,
      patientFullName,
    });

    const toolDefinition = buildToolDefinition();

    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: [toolDefinition],
        tool_choice: { type: "function", function: { name: "sn_visit_draft" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "AI did not return structured analysis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        mode,
        visit: parsed.visit,
        addedFields: parsed.addedFields ?? [],
        provenanceNotes: parsed.provenanceNotes ?? "",
        inputExcerpt: sourceExcerpt ?? "",
        generatedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sn-visit-draft error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

function buildUserMessage(p: {
  mode: "quick" | "recertNarrative";
  visitDate: string;
  visitNumber?: number;
  weekOfEpisode?: number;
  patientContext?: string;
  sourceExcerpt?: string;
  teachingFocus?: string;
  patientIdentifier?: string;
  patientFullName?: string;
}): string {
  const head = `Generate ONE SN visit note in mode="${p.mode}".

VISIT DATE: ${p.visitDate}
VISIT NUMBER: ${p.visitNumber ?? "(unspecified)"}
WEEK OF EPISODE: ${p.weekOfEpisode ?? "(unspecified)"}
PATIENT IDENTIFIER: ${p.patientIdentifier ?? "(unspecified)"}
PATIENT FULL NAME: ${p.patientFullName ?? "(unspecified — use 'Pt' in narrative)"}

PATIENT CONTEXT (Dx, current meds, goals — may be empty):
${(p.patientContext ?? "(none provided)").trim()}
`;

  if (p.mode === "quick") {
    return (
      head +
      `
NURSE SOURCE NOTES (the scribbled vitals / quick notes you must EXPAND from — do NOT add vitals not present here):
"""
${(p.sourceExcerpt ?? "").trim()}
"""

Now produce the polished single-visit note. Remember: never fabricate vitals; flag missing fields; expand narrative around what is present.`
    );
  }

  return (
    head +
    `
TEACHING FOCUS (optional — guide the education section):
${(p.teachingFocus ?? "(infer from patient context: cover disease process, meds, diet, lifestyle, safety)").trim()}

OPTIONAL RECERT PACKET EXCERPT (for context only — do not echo verbatim):
"""
${(p.sourceExcerpt ?? "").trim().slice(0, 8000)}
"""

Produce the narrative-heavy recert visit note. Vitals stay empty (they live in the OASIS). Education entries must each cover what / why-for-this-pt / diet+lifestyle+safety / teach-back Q+A / comprehension+mastery.`
  );
}

function buildToolDefinition() {
  return {
    type: "function",
    function: {
      name: "sn_visit_draft",
      description:
        "Return ONE polished SN visit note plus provenance metadata (addedFields, provenanceNotes).",
      parameters: {
        type: "object",
        properties: {
          visit: {
            type: "object",
            properties: {
              visitId: { type: "string" },
              visitNumber: { type: "number" },
              visitDate: { type: "string" },
              weekOfEpisode: { type: "number" },
              pdgmPeriod: { type: "number" },
              visitType: { type: "string" },
              subjective: { type: "string" },
              objective: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  bp: { type: "string" },
                  hr: { type: "number" },
                  rr: { type: "number" },
                  spo2: { type: "number" },
                  temp: { type: "number" },
                  weight: { type: "number" },
                  fsbg: { type: "number" },
                  painScore: { type: "number" },
                  edema: { type: "string" },
                  lungSounds: { type: "string" },
                  bowelSounds: { type: "string" },
                  ambulationDistanceFt: { type: "number" },
                  transferAssist: { type: "string" },
                },
                required: ["timestamp"],
                additionalProperties: false,
              },
              assessment: { type: "string" },
              plannedInterventions: { type: "array", items: { type: "string" } },
              educationDelivered: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    topicId: { type: "string" },
                    topic: { type: "string" },
                    response: { type: "string" },
                    comprehensionPct: { type: "number" },
                    masteryReached: { type: "boolean" },
                  },
                  required: ["topicId", "topic", "response", "comprehensionPct", "masteryReached"],
                  additionalProperties: false,
                },
              },
              skilledJustification: { type: "string" },
              coordinationOfCare: { type: "string" },
              goalsProgress: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    goalRef: { type: "string" },
                    status: { type: "string" },
                    evidence: { type: "string" },
                  },
                  required: ["goalRef", "status", "evidence"],
                  additionalProperties: false,
                },
              },
              nextVisitFocus: { type: "string" },
              homeboundRestated: { type: "string" },
              ggItemsTouched: { type: "array", items: { type: "string" } },
              sources: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    sourceDoc: { type: "string" },
                  },
                  required: ["field", "sourceDoc"],
                  additionalProperties: false,
                },
              },
              flags: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    severity: { type: "string" },
                    message: { type: "string" },
                  },
                  required: ["code", "severity", "message"],
                  additionalProperties: false,
                },
              },
            },
            required: [
              "visitId",
              "visitDate",
              "visitType",
              "subjective",
              "objective",
              "assessment",
              "plannedInterventions",
              "educationDelivered",
              "skilledJustification",
              "goalsProgress",
              "nextVisitFocus",
              "homeboundRestated",
              "sources",
              "flags",
            ],
            additionalProperties: false,
          },
          addedFields: {
            type: "array",
            items: { type: "string" },
            description: "Visit fields populated from clinical reasoning rather than directly from the source.",
          },
          provenanceNotes: {
            type: "string",
            description: "Short paragraph explaining what was drawn from source vs. expanded.",
          },
        },
        required: ["visit", "addedFields", "provenanceNotes"],
        additionalProperties: false,
      },
    },
  };
}

Deno.serve(handler);
