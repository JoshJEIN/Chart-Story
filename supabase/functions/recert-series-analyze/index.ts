// Recert Visit Series — generates SN visit notes for a SUBSEQUENT 60-day cert period
// from a recertification document packet plus (optionally) the prior episode's series result
// for education continuity.
//
// Pipeline (single LLM call with tool-calling, then audit loop):
//   1. Read fresh recert packet text (Recert OASIS, updated 485 POC, latest MD orders,
//      med profile, specialist notes, labs, recent SN/SOAP notes)
//   2. Build refreshed planOfCare (no discharge planning)
//   3. Reconcile education topics: drop mastered, carry forward in-progress, add new
//   4. Generate the entire 60-day SN visit series with the same audit gates as sn-series-analyze
//
// Mirrors security/CORS/health probe patterns of the other edge functions.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Skilled Nursing visit-series planner for a Texas home health agency, generating documentation for a RECERTIFICATION (subsequent) 60-day cert period — NOT a Start of Care.

You will receive (1) raw text of the recertification packet (Recert OASIS, updated 485 / Plan of Care, most recent physician orders, medication profile, specialist visits, lab work, recent SN/SOAP notes), (2) a pre-computed visit schedule covering the new 60-day cert period, and (3) OPTIONAL prior-episode context: the prior cert's planOfCare summary, its educationTopics, its educationLog (with masteredAt timestamps), and the prior episode's most recent visit summary.

Your job: produce the FULL 60-day cert period of SN visit notes plus a refreshed Plan of Care, plus a reconciled flat education topic list, all as audit-defensible billable drafts that survive PCR / TPE / UPIC / final-claim review.

You MUST use the recert_visit_series tool to return findings.

⚙️ MANDATORY OUTPUT RULES (NON-NEGOTIABLE)

1. RECERT POC (485-aligned, NO discharge planning)
   - planOfCare must be re-derived from the FRESH recert packet (updated dx, updated meds, updated frequency, updated goals). Do NOT echo prior POC verbatim if recert documentation has changed.
   - Required: primaryDx, secondaryDx[], homeboundJustification, skilledNeedRationale, measurableGoals[], disciplineOrders[], dmeSupplies. NO dischargePlanning field.

2. EDUCATION CONTINUITY (CRITICAL)
   - Drop any prior topic whose priorEducationLog entry has masteredAt != null. List them in educationDropped[] with reason="mastered".
   - Carry forward any prior topic still in progress (firstTaught != null && masteredAt == null). List them in educationCarriedForward[] with reason="in-progress" or "stalled".
   - Add NEW topics seeded from new dx, new meds, or new orders that appear in the recert packet but not in prior topics. These should appear in educationTopics with fresh ids.
   - HARD RULE: NEVER teach a topic that appears in priorEducationLog with masteredAt != null. Triggers RECERT_MASTERED_TOPIC_RETAUGHT (high).

3. NEW DX MUST BE ADDRESSED
   - Any diagnosis present in the new POC's primaryDx or secondaryDx that was NOT in prior POC must have at least one teaching topic AND at least one visit-level intervention. Track in newDxAddressed[].

4. ZERO CLONED DOCUMENTATION (same rules as SN series)
   - Vitals (BP, HR, RR, SpO2, temp, weight) vary visit-to-visit within physiologic ranges.
   - Wound L×W×D and tissue type must trend.
   - FSBG, lung sounds, edema grade, ambulation distance show variation tied to clinical events.
   - Pain score reflects intervention impact.
   - Every visit objective MUST include an ISO timestamp.

5. NO COPY-PASTE NARRATIVES
   - subjective, assessment, plannedInterventions, skilledJustification specific to THAT visit.
   - Each visit names a specific skilled action and a specific homebound driver.

6. EDUCATION ADVANCEMENT
   - basic → intermediate → advanced for each domain. Mastery = comprehensionPct >= 80 on 2 separate visits.
   - DO NOT make the same topic the primary focus for 3+ consecutive visits unless documenting a stall (comprehensionPct < 60 + "no progress"/"regressed").
   - Each visit teaches 1–3 topics, always at least one.

7. GOAL TRACEABILITY
   - Every visit's goalsProgress[] references at least one POC measurableGoal with status + objective evidence from THAT visit.
   - Across the cert period every POC goal is touched at least twice.

8. PDGM / LUPA AWARENESS
   - Every visit carries pdgmPeriod (1=days 1–30, 2=days 31–60).
   - episodeSummaries report visitsCompleted, lupaThreshold, lupaRisk, lupaImpactNote per period.

9. PRE-CLAIM POSTURE — ZERO TOLERANCE
   - No "[NOT DOCUMENTED]" placeholders in billable narrative fields. If source data is missing, mark visit.flags MISSING_SOURCE and set preClaimChecklist.billableDraftReady=false.
   - Every visit cites sources[] referencing only documents from the recert sourceTable you produce.
   - Recert F2F (or interim physician encounter) referenced in episodeSummaries[period 1].keyInterventions.

10. FREQUENCY MATCHES POC
    - frequencyOrder.raw must equal the SN frequencyDuration in the refreshed planOfCare.disciplineOrders. If user-supplied frequency differs, you MUST emit FREQ_POC_MISMATCH (high) unless a verbalOrder block was passed in input — in which case cite the verbal order in visit #1 coordinationOfCare and in preClaimChecklist.notes.

11. HHVBP / TEXAS COMPLIANCE
    - Touch GG-mobility or GG-self-care items on at least 30 % of visits.

12. HIPAA
    - Use "Pt" or initials only in narrative content. Real full name only in patientFullName.

13. RECERT VISIT MARKING
    - The first visit of the new cert period MUST be visitType="SN-Recert" and document the recert assessment.

🔁 AUDIT LOOP (STRICT)
Internally verify ALL of:
(a) every visit has timestamped objective with varying vitals,
(b) no two consecutive visits share identical BP, HR, weight, or pain score,
(c) every visit names a specific skilled action and a specific homebound driver,
(d) every visit updates at least one POC goal,
(e) education does not violate the 3-visit repetition rule,
(f) every billable narrative field is filled,
(g) every visit cites sources from the recert sourceTable,
(h) episodeSummaries include LUPA computation per period,
(i) at least 30 % of visits touch GG items,
(j) preClaimChecklist reflects actual visit content,
(k) frequencyOrder.raw matches the refreshed POC SN frequencyDuration OR a verbal order is on file and cited (FREQ_POC_MISMATCH otherwise),
(l) NO mastered topic from priorEducationLog appears as primary education in any visit (RECERT_MASTERED_TOPIC_RETAUGHT),
(m) every new dx in the refreshed POC has at least one teaching topic and one visit intervention (RECERT_NEW_DX_NOT_ADDRESSED),
(n) if the recert SN frequency differs from the prior episode's SN frequency, the rationale appears in visit #1 coordinationOfCare (RECERT_NO_FREQ_CHANGE_RATIONALE).

Set longitudinalAudit.pass=true ONLY if ALL pass. Otherwise pass=false and populate failures[] with code, severity, message, offendingVisitIds[]. The orchestrator will re-invoke you with revision instructions if pass=false.`;

interface VisitSlot {
  visitNumber: number;
  visitDate: string;
  weekOfEpisode: number;
  pdgmPeriod: 1 | 2;
}

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
        function: "recert-series-analyze",
        hasApiKey: Boolean(Deno.env.get("LOVABLE_API_KEY")),
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const MAX_PAYLOAD_BYTES = 9 * 1024 * 1024;
    const cl = req.headers.get("content-length");
    if (cl) {
      const declared = parseInt(cl, 10);
      if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
        return new Response(
          JSON.stringify({ error: `Payload too large (${(declared / 1024 / 1024).toFixed(1)} MB).` }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const body = await req.json();
    const {
      documents,            // [{name, text}] from parseDocuments
      schedule,             // VisitSlot[]
      certPeriod,
      frequencyOrder,
      lupaThresholds,
      maxIterations,
      verbalOrder,
      priorSeries,          // optional SnSeriesResult
    } = body ?? {};

    if (!Array.isArray(documents) || documents.length === 0 || !Array.isArray(schedule) || schedule.length === 0) {
      return new Response(
        JSON.stringify({ error: "documents[] and schedule[] are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const AI_GATEWAY_URL =
      Deno.env.get("AI_GATEWAY_URL") ?? "https://ai.gateway.lovable.dev/v1/chat/completions";

    const visitSlots = schedule as VisitSlot[];
    const period1Threshold = lupaThresholds?.period1 ?? null;
    const period2Threshold = lupaThresholds?.period2 ?? null;

    const userMessage = buildUserMessage(
      documents,
      visitSlots,
      certPeriod,
      frequencyOrder,
      period1Threshold,
      period2Threshold,
      verbalOrder ?? null,
      priorSeries ?? null,
    );

    const toolDefinition = buildToolDefinition();

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const requested = typeof maxIterations === "number" ? Math.floor(maxIterations) : 3;
    const MAX_AUDIT_ITERATIONS = Math.max(1, Math.min(10, requested));
    let analysisResult: any = null;
    let lastFailures: any[] = [];
    let iterationsRun = 0;

    for (let iteration = 1; iteration <= MAX_AUDIT_ITERATIONS; iteration++) {
      iterationsRun = iteration;
      console.log(`recert-series-analyze: iteration ${iteration}/${MAX_AUDIT_ITERATIONS}`);

      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages,
          tools: [toolDefinition],
          tool_choice: { type: "function", function: { name: "recert_visit_series" } },
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

      analysisResult = JSON.parse(toolCall.function.arguments);
      lastFailures = analysisResult.longitudinalAudit?.failures ?? [];

      console.log(
        `recert-series-analyze: iteration ${iteration} → pass=${analysisResult.longitudinalAudit?.pass}, failures=${lastFailures.length}`,
      );

      if (analysisResult.longitudinalAudit?.pass === true && lastFailures.length === 0) break;

      if (iteration < MAX_AUDIT_ITERATIONS) {
        const summary =
          lastFailures.length > 0
            ? lastFailures
                .map((f: any) => `  - [${f.code}/${f.severity}] ${f.message} (visits: ${(f.offendingVisitIds || []).join(", ")})`)
                .join("\n")
            : "  - longitudinalAudit.pass was not true; identify and fix all failing criteria.";
        messages.push({ role: "assistant", content: `Prior draft (iteration ${iteration}) failed longitudinal audit.` });
        messages.push({
          role: "user",
          content:
            `Revise to pass all longitudinal audit criteria. Failures:\n${summary}\n\nPreserve correct content; rewrite only the offending visits/sections. Return only when longitudinalAudit.pass == true.`,
        });
      }
    }

    if (analysisResult) {
      analysisResult._auditMeta = {
        iterations: iterationsRun,
        maxIterations: MAX_AUDIT_ITERATIONS,
        finalAuditPass: analysisResult.longitudinalAudit?.pass === true && lastFailures.length === 0,
        remainingFailures: lastFailures.map((f: any) => ({ criterion: f.code, reason: f.message })),
      };
    }

    return new Response(JSON.stringify(analysisResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recert-series-analyze error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

function buildUserMessage(
  documents: { name: string; text: string }[],
  visitSlots: VisitSlot[],
  certPeriod: any,
  frequencyOrder: any,
  period1Threshold: number | null,
  period2Threshold: number | null,
  verbalOrder: { date: string; orderingMd: string; content: string } | null,
  priorSeries: any | null,
): string {
  // Trim prior-series payload to bare essentials for continuity.
  const priorContext = priorSeries
    ? {
        certPeriod: priorSeries.certPeriod,
        planOfCare: priorSeries.planOfCare,
        educationTopics: priorSeries.educationTopics,
        priorEducationLog: priorSeries.educationLog,
        lastVisits: (priorSeries.visits ?? []).slice(-3),
        episodeSummaries: priorSeries.episodeSummaries,
        priorFrequencyOrderRaw: priorSeries.frequencyOrder?.raw,
      }
    : null;

  const docDump = documents
    .map((d, i) => `--- DOCUMENT ${i + 1}: ${d.name} ---\n${(d.text || "").slice(0, 18000)}`)
    .join("\n\n");

  return `Generate the complete RECERT SN visit series for the new 60-day certification period below.

CERT PERIOD (NEW): ${certPeriod?.startDate} → ${certPeriod?.endDate} (60 days)
FREQUENCY ORDER (raw, user-supplied): ${frequencyOrder?.raw}
TOTAL SN VISITS SCHEDULED: ${frequencyOrder?.totalVisitsScheduled}
LUPA THRESHOLD — PERIOD 1: ${period1Threshold ?? "unknown"}
LUPA THRESHOLD — PERIOD 2: ${period2Threshold ?? "unknown"}

${verbalOrder ? `VERBAL ORDER ON FILE — date=${verbalOrder.date}, MD=${verbalOrder.orderingMd}, content="${verbalOrder.content}". Cite verbatim in visit #1 coordinationOfCare and in preClaimChecklist.notes.` : "(No verbal order supplied — frequency must match the refreshed POC SN order.)"}

PRE-COMPUTED VISIT SCHEDULE (use exactly these dates):
${visitSlots.map((v) => `  #${v.visitNumber}  ${v.visitDate}  wk${v.weekOfEpisode}  P${v.pdgmPeriod}`).join("\n")}

${priorContext ? `PRIOR EPISODE CONTEXT (for education continuity, frequency-change rationale, and progress baseline):\n${JSON.stringify(priorContext, null, 2)}` : "PRIOR EPISODE CONTEXT: NONE PROVIDED — treat education topics as freshly seeded from the recert packet."}

RECERT DOCUMENT PACKET (raw text, ground truth for refreshed POC + sources):
${docDump}

Now produce the full recert series following the system rules.`;
}

function buildToolDefinition() {
  return {
    type: "function",
    function: {
      name: "recert_visit_series",
      description:
        "Return the complete 60-day RECERT SN visit series with refreshed POC, reconciled flat education topics, per-visit notes, education log, episode summaries, longitudinal audit, pre-claim checklist, and continuity metadata (carry-forward / dropped / new dx addressed).",
      parameters: {
        type: "object",
        properties: {
          patientIdentifier: { type: "string" },
          patientFullName: { type: "string" },
          certPeriod: {
            type: "object",
            properties: { startDate: { type: "string" }, endDate: { type: "string" }, day60: { type: "string" } },
            required: ["startDate", "endDate", "day60"],
            additionalProperties: false,
          },
          frequencyOrder: {
            type: "object",
            properties: {
              raw: { type: "string" },
              parsed: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    weeksLabel: { type: "string" },
                    visitsPerWeek: { type: "number" },
                    weeks: { type: "number" },
                    totalVisits: { type: "number" },
                    discipline: { type: "string" },
                  },
                  required: ["weeksLabel", "visitsPerWeek", "weeks", "totalVisits"],
                  additionalProperties: false,
                },
              },
              totalVisitsScheduled: { type: "number" },
            },
            required: ["raw", "parsed", "totalVisitsScheduled"],
            additionalProperties: false,
          },
          planOfCare: {
            type: "object",
            properties: {
              primaryDx: { type: "string" },
              secondaryDx: { type: "array", items: { type: "string" } },
              homeboundJustification: { type: "string" },
              skilledNeedRationale: { type: "string" },
              measurableGoals: { type: "array", items: { type: "string" } },
              disciplineOrders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    discipline: { type: "string" },
                    frequencyDuration: { type: "string" },
                    interventions: { type: "string" },
                  },
                  required: ["discipline", "frequencyDuration", "interventions"],
                  additionalProperties: false,
                },
              },
              dmeSupplies: { type: "string" },
            },
            required: ["primaryDx", "secondaryDx", "homeboundJustification", "skilledNeedRationale", "measurableGoals", "disciplineOrders", "dmeSupplies"],
            additionalProperties: false,
          },
          educationTopics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                topic: { type: "string" },
                linkedDxOrMed: { type: "string" },
                level: { type: "string", enum: ["basic", "intermediate", "advanced"] },
                prerequisiteIds: { type: "array", items: { type: "string" } },
                teachBackQuestions: { type: "array", items: { type: "string" } },
                teachingScript: { type: "string" },
              },
              required: ["id", "topic", "linkedDxOrMed", "level", "prerequisiteIds", "teachBackQuestions", "teachingScript"],
              additionalProperties: false,
            },
          },
          educationCarriedForward: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topicId: { type: "string" },
                topic: { type: "string" },
                level: { type: "string", enum: ["basic", "intermediate", "advanced"] },
                reason: { type: "string", enum: ["in-progress", "stalled"] },
              },
              required: ["topicId", "topic", "level", "reason"],
              additionalProperties: false,
            },
          },
          educationDropped: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topicId: { type: "string" },
                topic: { type: "string" },
                reason: { type: "string", enum: ["mastered", "no-longer-applicable"] },
                masteredAt: { type: "string" },
              },
              required: ["topicId", "topic", "reason"],
              additionalProperties: false,
            },
          },
          newDxAddressed: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dx: { type: "string" },
                firstAddressedVisitId: { type: "string" },
              },
              required: ["dx", "firstAddressedVisitId"],
              additionalProperties: false,
            },
          },
          visits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                visitId: { type: "string" },
                visitNumber: { type: "number" },
                visitDate: { type: "string" },
                weekOfEpisode: { type: "number" },
                pdgmPeriod: { type: "number", enum: [1, 2] },
                visitType: { type: "string", enum: ["SN-Assessment", "SN-Skilled", "SN-Recert", "SN-Discharge"] },
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
                    wound: {
                      type: "object",
                      properties: {
                        location: { type: "string" },
                        lengthCm: { type: "number" },
                        widthCm: { type: "number" },
                        depthCm: { type: "number" },
                        tissueType: { type: "string" },
                        drainage: { type: "string" },
                        periwound: { type: "string" },
                      },
                      required: ["location", "lengthCm", "widthCm", "depthCm", "tissueType", "drainage", "periwound"],
                      additionalProperties: false,
                    },
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
                      response: { type: "string" },
                      comprehensionPct: { type: "number" },
                      masteryReached: { type: "boolean" },
                    },
                    required: ["topicId", "response", "comprehensionPct", "masteryReached"],
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
                      status: { type: "string", enum: ["met", "progressing", "no-change", "regressed"] },
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
                    properties: { field: { type: "string" }, sourceDoc: { type: "string" } },
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
                      severity: { type: "string", enum: ["high", "medium", "low"] },
                      message: { type: "string" },
                    },
                    required: ["code", "severity", "message"],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                "visitId", "visitNumber", "visitDate", "weekOfEpisode", "pdgmPeriod", "visitType",
                "subjective", "objective", "assessment", "plannedInterventions",
                "educationDelivered", "skilledJustification", "goalsProgress",
                "nextVisitFocus", "homeboundRestated", "sources", "flags",
              ],
              additionalProperties: false,
            },
          },
          educationLog: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topicId: { type: "string" },
                topic: { type: "string" },
                level: { type: "string" },
                firstTaught: { type: "string" },
                reinforcedAt: { type: "array", items: { type: "string" } },
                masteredAt: { type: "string" },
                advancedToTopicId: { type: "string" },
              },
              required: ["topicId", "topic", "level", "firstTaught", "reinforcedAt"],
              additionalProperties: false,
            },
          },
          episodeSummaries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                period: { type: "number", enum: [1, 2] },
                visitsCompleted: { type: "number" },
                visitsScheduled: { type: "number" },
                lupaThreshold: { type: "number" },
                lupaRisk: { type: "string", enum: ["below", "at", "above", "unknown"] },
                lupaImpactNote: { type: "string" },
                progress: { type: "string", enum: ["improved", "stable", "declined"] },
                keyInterventions: { type: "array", items: { type: "string" } },
                remainingNeeds: { type: "array", items: { type: "string" } },
              },
              required: ["period", "visitsCompleted", "visitsScheduled", "lupaRisk", "lupaImpactNote", "progress", "keyInterventions", "remainingNeeds"],
              additionalProperties: false,
            },
          },
          longitudinalAudit: {
            type: "object",
            properties: {
              pass: { type: "boolean" },
              failures: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    severity: { type: "string", enum: ["high", "medium", "low"] },
                    message: { type: "string" },
                    offendingVisitIds: { type: "array", items: { type: "string" } },
                  },
                  required: ["code", "severity", "message", "offendingVisitIds"],
                  additionalProperties: false,
                },
              },
            },
            required: ["pass", "failures"],
            additionalProperties: false,
          },
          preClaimChecklist: {
            type: "object",
            properties: {
              f2fLinked: { type: "boolean" },
              ordersOnFile: { type: "boolean" },
              oasisCongruent: { type: "boolean" },
              measurableGoalsTied: { type: "boolean" },
              homeboundJustifiedEachVisit: { type: "boolean" },
              educationProgressionDocumented: { type: "boolean" },
              noClonedObjectiveFindings: { type: "boolean" },
              lupaAddressed: { type: "boolean" },
              billableDraftReady: { type: "boolean" },
              notes: { type: "string" },
            },
            required: ["f2fLinked", "ordersOnFile", "oasisCongruent", "measurableGoalsTied", "homeboundJustifiedEachVisit", "educationProgressionDocumented", "noClonedObjectiveFindings", "lupaAddressed", "billableDraftReady", "notes"],
            additionalProperties: false,
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
        },
        required: [
          "patientIdentifier", "patientFullName", "certPeriod", "frequencyOrder",
          "planOfCare", "educationTopics", "educationCarriedForward", "educationDropped",
          "newDxAddressed", "visits", "educationLog",
          "episodeSummaries", "longitudinalAudit", "preClaimChecklist",
          "redFlags", "sourceTable",
        ],
        additionalProperties: false,
      },
    },
  };
}

Deno.serve(handler);
