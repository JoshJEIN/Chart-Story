// SN Visit Series Generator — produces the entire 60-day cert-period of SN visit
// notes from a prior SOC analysis + a parsed physician-orders frequency string.
// Mirrors the security/CORS/health-probe patterns of soc-analyze and pcr-analyze.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Skilled Nursing visit-series planner for a Texas home health agency. You will receive (1) a completed Start-of-Care (SOC) analysis JSON for the patient (Plan of Care, education topics, red flags, source table) and (2) a pre-computed visit schedule covering the 60-day certification period.

Your job: generate every SN visit note for the entire 60-day cert period as audit-defensible billable drafts that will survive pre-claim review (PCR), TPE, UPIC, and final-claim reviews.

You MUST use the sn_visit_series tool to return findings.

⚙️ MANDATORY OUTPUT RULES (NON-NEGOTIABLE)

1. ZERO CLONED DOCUMENTATION
   - Vitals (BP, HR, RR, SpO2, temperature, weight) must vary visit-to-visit within physiologically plausible ranges:
     • BP systolic ±2–15 mmHg between consecutive visits, diastolic ±2–10
     • HR ±2–10 bpm
     • RR ±0–4
     • SpO2 ±0–3 %
     • Weight ±0.0–1.5 lb unless documented edema/diuresis event
     • Pain score should reflect intervention impact (typically trending down with effective SN care; do not flatten at one number across all visits)
   - Wound L×W×D and tissue type must trend (improve, plateau, or worsen) — never leave wound dimensions identical across 3+ visits without explicit rationale.
   - FSBG, lung sounds, edema grade, ambulation distance must show variation tied to clinical events.
   - EVERY visit objective MUST include an ISO timestamp (date + time of visit).

2. NO COPY-PASTE NARRATIVES
   - subjective, assessment, plannedInterventions, skilledJustification must be specific to THAT visit's findings, not boilerplate.
   - Each visit's skilledJustification names the specific skilled action performed THAT visit and why an unlicensed person could not safely deliver it.
   - Each visit restates homebound status with a visit-specific clinical driver — never copy the SOC homebound paragraph.

3. EDUCATION = FLAT TOPIC LIST + PER-VISIT ASSIGNMENT (advancement logic)
   - Output a single flat educationTopics array seeded from the SOC educationPlan but normalized to {id, topic, linkedDxOrMed, level: "basic"|"intermediate"|"advanced", prerequisiteIds[], teachBackQuestions[], teachingScript}.
   - Across visits, advance topics: basic → intermediate → advanced for each domain (e.g., Diabetes basic → Insulin admin → Hypoglycemia recognition & complications).
   - A topic is "mastered" when comprehensionPct >= 80 on 2 separate visits; once mastered, the next-level topic in the same domain becomes the focus.
   - DO NOT make the same topic the primary focus for 3+ consecutive visits unless you document a stall (comprehensionPct < 60 with response narrative explicitly stating "no progress" or "regressed").
   - Each visit teaches 1–3 topics. Always include at least one topic per visit.

4. GOAL TRACEABILITY
   - Every visit's goalsProgress[] must reference at least one POC measurableGoal and document status + objective evidence from THAT visit.
   - Across the cert period every POC goal must be touched at least twice.

5. PDGM / LUPA AWARENESS
   - Every visit carries pdgmPeriod (1 = days 1–30, 2 = days 31–60).
   - Per-period episodeSummaries report visitsCompleted, lupaThreshold (use the value provided in input, otherwise null), lupaRisk, lupaImpactNote.

6. PRE-CLAIM POSTURE — ZERO TOLERANCE
   - No "[NOT DOCUMENTED]" placeholders allowed in billable narrative fields (subjective, objective.timestamp, assessment, skilledJustification). If source data is genuinely missing, mark visit.flags with code="MISSING_SOURCE" and set preClaimChecklist.billableDraftReady=false.
   - Every visit must include sources[] with field→sourceDoc mappings using only documents from the SOC sourceTable.
   - F2F encounter must be referenced in episodeSummaries[*].keyInterventions for at least period 1.

7. HHVBP / TEXAS COMPLIANCE
   - Touch GG-mobility or GG-self-care items on at least 30 % of visits (ggItemsTouched array). This supports HHVBP claims-based measure capture.

8. HIPAA
   - Use "Pt" or initials only in narrative content. Real full name only in patientFullName field.

9. PLAN OF CARE
   - Echo the SOC planOfCare verbatim (primaryDx, secondaryDx[], homeboundJustification, skilledNeedRationale, measurableGoals[], disciplineOrders[], dmeSupplies). Do NOT include dischargePlanning — it is OUT OF SCOPE for SOC and for this series.

🔁 AUDIT LOOP (STRICT)
Before returning, internally verify ALL of:
(a) every visit has timestamped objective with varying vitals vs the previous visit,
(b) no two consecutive visits share identical BP, HR, weight, or pain score,
(c) every visit names a specific skilled action and a specific homebound driver,
(d) every visit updates at least one POC goal,
(e) education does not violate the 3-visit repetition rule,
(f) every billable narrative field is filled (no placeholder text),
(g) every visit cites sources from the provided source table,
(h) episodeSummaries include LUPA computation per period,
(i) at least 30 % of visits touch GG items,
(j) preClaimChecklist reflects actual visit content,
(k) frequencyOrder.raw equals the physician-ordered frequency from the 485 POC OR a verbal order is on file and cited in preClaimChecklist.notes and in visit #1 coordinationOfCare. If neither condition holds, add a failure with code="FREQ_POC_MISMATCH" severity="high".

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
        function: "sn-series-analyze",
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
      socResult,
      schedule,
      certPeriod,
      frequencyOrder,
      lupaThresholds,
      maxIterations,
      expectedFrequencyFromPOC,
      verbalOrder,
    } = body ?? {};

    if (!socResult || !Array.isArray(schedule) || schedule.length === 0) {
      return new Response(
        JSON.stringify({ error: "socResult and schedule[] are required." }),
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
      socResult,
      visitSlots,
      certPeriod,
      frequencyOrder,
      period1Threshold,
      period2Threshold,
      expectedFrequencyFromPOC ?? null,
      verbalOrder ?? null,
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
      console.log(`sn-series-analyze: iteration ${iteration}/${MAX_AUDIT_ITERATIONS}`);

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
          tool_choice: { type: "function", function: { name: "sn_visit_series" } },
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
        `sn-series-analyze: iteration ${iteration} → pass=${analysisResult.longitudinalAudit?.pass}, failures=${lastFailures.length}`,
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
    console.error("sn-series-analyze error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

function buildUserMessage(
  socResult: any,
  visitSlots: VisitSlot[],
  certPeriod: any,
  frequencyOrder: any,
  period1Threshold: number | null,
  period2Threshold: number | null,
  expectedFrequencyFromPOC: string | null,
  verbalOrder: { date: string; orderingMd: string; content: string } | null,
): string {
  // Trim SOC payload to keep token budget reasonable.
  const socSummary = {
    patientIdentifier: socResult.patientIdentifier,
    patientFullName: socResult.patientFullName,
    episodeInfo: socResult.episodeInfo,
    planOfCare: socResult.planOfCare,
    educationPlan: socResult.educationPlan,
    redFlags: socResult.redFlags,
    sourceTable: socResult.sourceTable,
    medicationReconciliation: socResult.medicationReconciliation,
  };

  const freqMatch =
    expectedFrequencyFromPOC && expectedFrequencyFromPOC.trim() === (frequencyOrder?.raw ?? "").trim();

  const freqBlock = expectedFrequencyFromPOC
    ? `\nPHYSICIAN-ORDERED FREQUENCY (from 485 POC): ${expectedFrequencyFromPOC}\nUSER-SUPPLIED FREQUENCY: ${frequencyOrder?.raw}\nFREQUENCY MATCHES POC: ${freqMatch ? "YES" : "NO"}\n${
        !freqMatch && verbalOrder
          ? `VERBAL ORDER ON FILE — date=${verbalOrder.date}, MD=${verbalOrder.orderingMd}, content="${verbalOrder.content}". You MUST cite this verbal order in visit #1 coordinationOfCare and in preClaimChecklist.notes.`
          : !freqMatch
          ? `NO VERBAL ORDER PROVIDED. This is an audit failure (FREQ_POC_MISMATCH).`
          : `Frequency matches physician orders.`
      }\n`
    : "\n(No POC frequency was provided for cross-check.)\n";

  return `Generate the complete SN visit series for the 60-day certification period below.

CERT PERIOD: ${certPeriod?.startDate} → ${certPeriod?.endDate} (60 days)
FREQUENCY ORDER (raw): ${frequencyOrder?.raw}
TOTAL SN VISITS SCHEDULED: ${frequencyOrder?.totalVisitsScheduled}
LUPA THRESHOLD — PERIOD 1 (days 1–30): ${period1Threshold ?? "unknown"}
LUPA THRESHOLD — PERIOD 2 (days 31–60): ${period2Threshold ?? "unknown"}
${freqBlock}
PRE-COMPUTED VISIT SCHEDULE (visitNumber, visitDate, weekOfEpisode, pdgmPeriod) — use exactly these dates:
${visitSlots.map((v) => `  #${v.visitNumber}  ${v.visitDate}  wk${v.weekOfEpisode}  P${v.pdgmPeriod}`).join("\n")}

SOC ANALYSIS JSON (use as ground truth for POC, education seed, sources):
${JSON.stringify(socSummary, null, 2)}

Now produce the full series following the system rules.`;
}

function buildToolDefinition() {
  return {
    type: "function",
    function: {
      name: "sn_visit_series",
      description:
        "Return the complete 60-day SN visit series with embedded POC, flat education topics, per-visit notes, education log, episode summaries, longitudinal audit, and pre-claim checklist.",
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
          visits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                visitId: { type: "string" },
                visitNumber: { type: "number" },
                visitDate: { type: "string" },
                weekOfEpisode: { type: "number" },
                pdgmPeriod: { type: "number" },
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
                period: { type: "number" },
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
          "planOfCare", "educationTopics", "visits", "educationLog",
          "episodeSummaries", "longitudinalAudit", "preClaimChecklist",
          "redFlags", "sourceTable",
        ],
        additionalProperties: false,
      },
    },
  };
}

Deno.serve(handler);
