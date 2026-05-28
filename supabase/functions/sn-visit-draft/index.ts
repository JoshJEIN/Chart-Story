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

const QUICK_SYSTEM_PROMPT = `You are a Medicare home-health SN visit-note writer (Texas). Take short scribbled nurse notes and expand into ONE audit-defensible SN visit note (PCR/TPE/UPIC-ready). MUST call the sn_visit_draft tool.

RULES:
1) NEVER fabricate vitals/objective data. Populate objective fields ONLY if the exact value is in the source; otherwise leave null and add flag {code:"MISSING_SOURCE",severity:"medium",message:"<field> not documented"}. objective.timestamp = visit date + time from source, else 09:00.
2) FIRST PERSON, PAST TENSE ("I assessed/auscultated/instructed"). Never "the nurse"/"the RN"/third person.
   - subjective: 2-4 sentences of Pt's report.
   - assessment: clinical reasoning linking findings to Dx/meds/trajectory.
   - plannedInterventions: 5-8 entries, each 2-4 sentences describing what I DID TODAY. Each MUST include (a) the bedside action, (b) today's actual vital/finding numbers from source, (c) how Pt's AGE + comorbidity/med interactions shaped it (e.g., elderly+diuretic→orthostatic check; CHF+COPD→fluid vs air-trapping; DM+CKD→renal dosing), (d) HOME ENVIRONMENT factor observed today (rugs, stairs, lighting, caregiver, med storage, O2 setup, bathroom safety), (e) measurable response/threshold. FORBIDDEN: "will", "RN to", "next visit", "plan to", "continue to monitor" — today's completed work only.
   - educationDelivered: every teaching mention → {topicId, response, comprehensionPct, masteryReached}. response = what topic is + why it matters to THIS Pt's Dx/meds/safety + actual teach-back. If none in source, include one safety/med topic from patient context.
   - coordinationOfCare: MD calls/referrals/pharmacy/family in first person, else "No additional coordination required this visit beyond standing orders."
   - goalsProgress: tie to supplied goals, ≥1 entry.
   - nextVisitFocus: 1-2 sentences ("Next visit I will...").
   - homeboundRestated: visit-specific clinical driver, never boilerplate.
   - skilledJustification: "" (intentionally omitted downstream).
3) PROVENANCE: addedFields[] lists fields populated from reasoning vs source. sources[] cites "nurse source notes" or "patient context".
4) HIPAA: "Pt"/initials in narrative; real name only in patientFullName.
5) visitType = "SN-Skilled" unless source says otherwise.`;

const RECERT_NARRATIVE_SYSTEM_PROMPT = `You are a Medicare home-health SN visit-note writer (Texas). Produce ONE narrative-heavy recert-period SN visit note that complies with Texas BON / TAC §97 home-health documentation standards. MUST call the sn_visit_draft tool.

RULES:
1) VITALS ARE IN-SCOPE. Populate every objective field for which the source/nurse note provides an exact value (BP, HR, RR, SpO2, temp, weight, FSBG, pain, edema, lung/bowel sounds, ambulation, transfer). NEVER fabricate. For any vital not in the source, leave null and add flag {code:"MISSING_SOURCE",severity:"low",message:"<field> not documented"}. objective.timestamp = visit date + time from source, else 09:00.
2) ABNORMAL-VITAL HANDLING: If a vital is abnormal relative to this Pt's Dx/POC (e.g., CHF + SBP >160 or <90, COPD + SpO2 <90%, DM + FSBG <70 or >300, HTN crisis, febrile, tachycardia with cardiac Dx, orthostatic drop on diuretic, CKD-relevant BP/FSBG drift), you MUST:
   (a) Name the abnormal value in the assessment paragraph tied to the specific Dx and POC threshold.
   (b) Add ONE dedicated plannedInterventions entry describing the SKILLED intervention I performed THIS visit — first person, past tense — including bedside action, why this Pt's Dx/meds/age required it, home-environment/caregiver factor, MD/pharmacy notification when applicable, teach-back on red flags, and the measurable threshold for escalation/911.
   (c) Add flag {code:"ABNORMAL_VITAL_ADDRESSED",severity:"medium",message:"<finding> — skilled intervention documented"}.
3) MERGE NURSE SOURCE NOTE (when sourceExcerpt is provided): Treat it as the authoritative visit content. Rewrite it to Texas standards and DISTRIBUTE its content into the matching structured fields — do NOT append it as a raw block:
   - Pre-visit call, bag technique, hand hygiene, infection-control steps → first plannedInterventions entry.
   - Vital values, pain score, FSBG → objective fields (exact numbers).
   - Pt-reported symptoms, denials (e.g., "no headache"), caregiver input → subjective.
   - Dx review, med reconciliation, clinical reasoning around abnormal findings → assessment (per rule 2a when abnormal).
   - Each teaching topic in the nurse note → its own educationDelivered entry meeting rule 4. Preserve ALL taught content; reorganize, don't drop.
   - Next-visit plan from the nurse note → nextVisitFocus.
   - 911/escalation instruction → embed in the relevant education entry AND in the abnormal-vital intervention when applicable.
   Rewrite to first person past tense ("I assessed/instructed/auscultated"), use "Pt"/"Cg"/initials, remove third-person "SN"/"the nurse," correct grammar, expand abbreviations on first use, and ensure every skilled action is tied to a named Dx, med, or POC goal.
4) EDUCATION (deepest section). Each educationDelivered.response MUST cover: (a) what the topic is in plain language, (b) why it matters to THIS Pt — name their Dx and/or specific med, (c) diet/lifestyle/safety changes required to fit that Dx + those meds, (d) teach-back Q used + Pt's actual answer vs target, (e) comprehension % + mastery. Include 3-6 entries spanning disease process, meds (incl. side effects + interactions), diet, lifestyle/activity, safety/red flags. When a nurse-note teaching topic is present, it MUST appear here verbatim-in-substance with these five elements filled in.
5) NARRATIVE DEPTH:
   - subjective: 3-5 sentences on 60-day trajectory, current concerns, caregiver input, Pt denials.
   - assessment: full clinical reasoning paragraph linking prior-episode progress to the recert decision, naming each active Dx + trend, with any abnormal-vital narrative per rule 2a.
   - plannedInterventions: 5-8 skilled interventions for the upcoming 60-day cert, each tied to a named Dx/med (plus rule-2b abnormal-vital intervention and rule-3 infection-control/bag-technique entry when applicable).
   - skilledJustification: explicit statement justifying recert under Medicare skilled-need criteria.
6) COORDINATION OF CARE required: MD recert acknowledgement, referrals (PT/OT/MSW/HHA) as indicated, pharmacy reconciliation, family/caregiver involvement.
7) nextVisitFocus 2-3 sentences naming priority for visit #1 of new cert. homeboundRestated = visit-specific clinical driver, never boilerplate.
8) goalsProgress: every prior-POC/context goal named with status + evidence.
9) addedFields[] lists reasoning-derived fields; provenanceNotes describes what came from nurse source vs reasoning.
10) HIPAA: "Pt"/initials only in narrative; real name in patientFullName. visitType = "SN-Recert".`;

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
        model: "google/gemini-2.5-flash-lite",
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
        patientIdentifier: patientIdentifier ?? "",
        patientFullName: patientFullName ?? "",
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
