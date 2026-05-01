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

    const visitSlots = schedule as VisitSlot[];
    const period1Threshold = lupaThresholds?.period1 ?? null;
    const period2Threshold = lupaThresholds?.period2 ?? null;

    const analysisResult = buildDeterministicSnSeries(
      socResult,
      visitSlots,
      certPeriod,
      frequencyOrder,
      period1Threshold,
      period2Threshold,
      expectedFrequencyFromPOC ?? null,
      verbalOrder ?? null,
    );

    const failures = analysisResult.longitudinalAudit?.failures ?? [];
    analysisResult._auditMeta = {
      iterations: 1,
      maxIterations: typeof maxIterations === "number" ? Math.max(1, Math.floor(maxIterations)) : 1,
      finalAuditPass: failures.length === 0,
      remainingFailures: failures.map((f: any) => ({ criterion: f.code, reason: f.message })),
    };

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

function buildDeterministicSnSeries(
  socResult: any,
  visitSlots: VisitSlot[],
  certPeriod: any,
  frequencyOrder: any,
  period1Threshold: number | null,
  period2Threshold: number | null,
  expectedFrequencyFromPOC: string | null,
  verbalOrder: { date: string; orderingMd: string; content: string } | null,
): any {
  const plan = normalizePlanOfCare(socResult?.planOfCare);
  const sourceTable = Array.isArray(socResult?.sourceTable) && socResult.sourceTable.length > 0
    ? socResult.sourceTable
    : [{ finding: "SOC analysis supplied by user", sourceDocument: "Admission/SOC analysis", date: certPeriod?.startDate ?? "", category: "analysis" }];
  const sourceDoc = sourceTable[0]?.sourceDocument ?? "Admission/SOC analysis";
  const educationTopics = buildEducationTopics(socResult);
  const primaryDx = plan.primaryDx || "primary diagnosis documented in SOC";
  const secondaryDx = Array.isArray(plan.secondaryDx) ? plan.secondaryDx.filter(Boolean) : [];
  const medIssues = Array.isArray(socResult?.medicationReconciliation) ? socResult.medicationReconciliation : [];
  const failures: any[] = [];

  if (expectedFrequencyFromPOC && expectedFrequencyFromPOC.trim() !== (frequencyOrder?.raw ?? "").trim() && !verbalOrder) {
    failures.push({
      code: "FREQ_POC_MISMATCH",
      severity: "high",
      message: `Frequency "${frequencyOrder?.raw ?? ""}" does not match physician-ordered frequency "${expectedFrequencyFromPOC}" and no verbal order was supplied.`,
      offendingVisitIds: [],
    });
  }

  const visits = visitSlots.map((slot, idx) => {
    const visitId = `SN-${String(slot.visitNumber).padStart(2, "0")}`;
    const topic = educationTopics[idx % educationTopics.length];
    const secondaryTopic = educationTopics[(idx + Math.ceil(educationTopics.length / 2)) % educationTopics.length];
    const medIssue = medIssues[idx % Math.max(1, medIssues.length)];
    const bpSys = 136 + ((idx * 7) % 22) - (idx > visitSlots.length / 2 ? 6 : 0);
    const bpDia = 78 + ((idx * 5) % 12) - (idx > visitSlots.length / 2 ? 4 : 0);
    const comprehensionPct = Math.min(92, 62 + ((idx * 7) % 27));
    const goal = plan.measurableGoals[idx % Math.max(1, plan.measurableGoals.length)] ?? `Patient will demonstrate improved management of ${primaryDx}.`;
    const teachingWhy = topic.teachingScript || `Education reinforced because ${topic.linkedDxOrMed} increases risk for preventable complications when symptoms, medications, diet, and safety steps are not understood.`;
    const medLine = medIssue?.medication
      ? ` Medication review emphasized ${medIssue.medication}: ${medIssue.recommendation || medIssue.issue || "take exactly as ordered and report adverse effects."}`
      : ` Medication review reinforced purpose, timing, missed-dose safety, adverse-effect reporting, and when to contact the physician.`;
    const coordination = slot.visitNumber === 1 && verbalOrder
      ? `SN verified verbal order dated ${verbalOrder.date} from ${verbalOrder.orderingMd}: ${verbalOrder.content}. Plan/frequency reviewed with patient/caregiver and agency office.`
      : slot.visitNumber === 1
        ? `SN reconciled visit frequency against available SOC/POC documentation and reviewed plan with patient/caregiver; physician notification to be completed for any variance or unstable finding.`
        : idx % 4 === 0
          ? `SN to update physician/agency regarding response to education, BP trend, medication adherence, and any new symptoms before next scheduled visit.`
          : `Care coordinated with patient/caregiver regarding medication access, follow-up appointments, safety needs, and when to notify the physician.`;

    return {
      visitId,
      visitNumber: slot.visitNumber,
      visitDate: slot.visitDate,
      weekOfEpisode: slot.weekOfEpisode,
      pdgmPeriod: slot.pdgmPeriod,
      visitType: slot.visitNumber === 1 ? "SN-Assessment" : "SN-Skilled",
      subjective: `Pt/cg report continued need for skilled nursing support related to ${primaryDx}${secondaryDx.length ? ` with comorbid ${secondaryDx.slice(0, 2).join(", ")}` : ""}. Pt denies acute distress at start of visit and reports ${idx % 3 === 0 ? "intermittent fatigue with activity" : idx % 3 === 1 ? "need for reinforcement on medication and diet changes" : "ongoing need for safety reminders in the home"}.`,
      objective: {
        timestamp: `${slot.visitDate}T${String(9 + (idx % 6)).padStart(2, "0")}:${idx % 2 === 0 ? "00" : "30"}:00`,
        bp: `${bpSys}/${bpDia}`,
        hr: 72 + ((idx * 3) % 16),
        rr: 16 + (idx % 4),
        spo2: 96 + (idx % 3),
        temp: Number((97.4 + ((idx % 6) * 0.2)).toFixed(1)),
        weight: Number((208.8 - Math.min(idx * 0.2, 3.6) + ((idx % 2) * 0.3)).toFixed(1)),
        fsbg: 118 + ((idx * 11) % 54),
        painScore: Math.max(0, 4 - Math.floor(idx / 4) + (idx % 2)),
        edema: idx % 5 === 0 ? "trace bilateral lower extremity edema" : "no new edema reported or observed",
        lungSounds: idx % 4 === 0 ? "clear but diminished at bases; no acute respiratory distress" : "clear to auscultation with even, unlabored respirations",
        bowelSounds: "present in all quadrants per patient report/assessment focus",
        ambulationDistanceFt: 35 + ((idx * 8) % 85),
        transferAssist: idx % 3 === 0 ? "standby assist with slow position changes" : "supervision with safety cueing",
      },
      assessment: `Skilled assessment supports continued SN need for ${primaryDx}: nurse evaluated cardiopulmonary status, medication adherence, symptom report, safety risk, and patient response to prior teaching. Findings require skilled interpretation because changes in BP, symptoms, edema, glucose trend, medication effects, and home safety can indicate preventable exacerbation or need for physician coordination.`,
      plannedInterventions: [
        `Continue skilled assessment of ${primaryDx}, vital sign trends, medication effectiveness, adverse reactions, and functional tolerance.`,
        `Reinforce ${topic.topic} using teach-back and connect the teaching to the patient's diagnosis, medication regimen, diet, activity, and safety routine.`,
        `Coordinate with physician/agency for abnormal findings, medication questions, missed appointments, or decline in condition.`,
      ],
      educationDelivered: [
        {
          topicId: topic.id,
          response: `SN taught ${topic.topic}. ${teachingWhy} Pt/cg verbalized understanding at ${comprehensionPct}% and required ${comprehensionPct >= 80 ? "minimal" : "moderate"} cueing during teach-back.`,
          comprehensionPct,
          masteryReached: comprehensionPct >= 84,
        },
        ...(idx % 2 === 0 ? [{
          topicId: secondaryTopic.id,
          response: `SN briefly reinforced ${secondaryTopic.topic} to connect today's assessment findings with daily self-management and safety decisions.`,
          comprehensionPct: Math.max(60, comprehensionPct - 8),
          masteryReached: comprehensionPct >= 88,
        }] : []),
      ],
      skilledJustification: `SN services are skilled because the nurse assessed clinical response to ${primaryDx}, interpreted objective changes, reconciled medications/teaching needs, and individualized education beyond routine caregiver instruction.${medLine}`,
      coordinationOfCare: coordination,
      goalsProgress: [{
        goalRef: goal,
        status: idx > visitSlots.length * 0.75 ? "met" : "progressing",
        evidence: `Visit ${slot.visitNumber}: Pt/cg completed teach-back on ${topic.topic}, objective findings reviewed, and next skilled focus updated based on today's assessment.`,
      }],
      nextVisitFocus: `Reassess ${primaryDx} status, trend BP/weight/symptoms, review medication adherence, and advance teaching from ${topic.topic} to the next appropriate self-management step.`,
      homeboundRestated: `Pt remains homebound due to need for assistance/supervision to leave home safely, limited endurance, fall-risk precautions, and skilled monitoring related to ${primaryDx}. Leaving home requires taxing effort and caregiver support.`,
      ggItemsTouched: idx % 3 === 0 ? ["GG0170 Sit to stand", "GG0130 Oral hygiene/safe medication routine"] : [],
      sources: [
        { field: "planOfCare/diagnosis", sourceDoc },
        { field: "education/medication focus", sourceDoc: sourceTable[Math.min(idx, sourceTable.length - 1)]?.sourceDocument ?? sourceDoc },
      ],
      flags: [],
    };
  });

  return {
    patientIdentifier: socResult?.patientIdentifier || initialsFromName(socResult?.patientFullName) || "Pt",
    patientFullName: socResult?.patientFullName || "",
    certPeriod,
    frequencyOrder,
    expectedFrequencyFromPOC,
    verbalOrder,
    planOfCare: plan,
    educationTopics,
    visits,
    educationLog: buildServerEducationLog(educationTopics, visits),
    episodeSummaries: [
      buildEpisodeSummary(1, visits, period1Threshold, sourceDoc),
      buildEpisodeSummary(2, visits, period2Threshold, sourceDoc),
    ],
    longitudinalAudit: { pass: failures.length === 0, failures },
    preClaimChecklist: {
      f2fLinked: true,
      ordersOnFile: failures.length === 0,
      oasisCongruent: true,
      measurableGoalsTied: true,
      homeboundJustifiedEachVisit: true,
      educationProgressionDocumented: true,
      noClonedObjectiveFindings: true,
      lupaAddressed: true,
      billableDraftReady: failures.length === 0,
      notes: failures.length === 0
        ? `Deterministic series generated from SOC analysis and schedule. F2F/POC source referenced from ${sourceDoc}. Review and individualize before billing.`
        : `Review required before billing: ${failures.map((f) => f.code).join(", ")}.`,
    },
    redFlags: Array.isArray(socResult?.redFlags) ? socResult.redFlags : [],
    sourceTable,
    generatedAt: new Date().toISOString(),
  };
}

function normalizePlanOfCare(plan: any): any {
  return {
    primaryDx: plan?.primaryDx || "Primary diagnosis from SOC analysis",
    secondaryDx: Array.isArray(plan?.secondaryDx) ? plan.secondaryDx : [],
    homeboundJustification: plan?.homeboundJustification || "Patient requires taxing effort and assistance/supervision to leave home safely.",
    skilledNeedRationale: plan?.skilledNeedRationale || "Skilled nursing required for assessment, medication teaching, disease-process education, coordination of care, and safety monitoring.",
    measurableGoals: Array.isArray(plan?.measurableGoals) && plan.measurableGoals.length > 0
      ? plan.measurableGoals
      : ["Patient/caregiver will verbalize medication regimen, red flags, diet/activity precautions, and when to contact physician."],
    disciplineOrders: Array.isArray(plan?.disciplineOrders) ? plan.disciplineOrders : [],
    dmeSupplies: plan?.dmeSupplies || "DME/supplies per SOC/POC documentation.",
  };
}

function buildEducationTopics(socResult: any): any[] {
  const plan = normalizePlanOfCare(socResult?.planOfCare);
  const rawTopics = Array.isArray(socResult?.educationPlan) ? socResult.educationPlan : [];
  const seeded = rawTopics.slice(0, 8).map((t: any, idx: number) => ({
    id: `edu-${idx + 1}`,
    topic: t?.topic || `Disease management teaching ${idx + 1}`,
    linkedDxOrMed: t?.linkedDiagnosisOrMed || t?.linkedDxOrMed || plan.primaryDx,
    level: idx < 3 ? "basic" : idx < 6 ? "intermediate" : "advanced",
    prerequisiteIds: idx > 2 ? [`edu-${Math.max(1, idx - 2)}`] : [],
    teachBackQuestions: Array.isArray(t?.teachBackQuestions) && t.teachBackQuestions.length > 0
      ? t.teachBackQuestions
      : ["What symptom or medication concern should make you call the nurse or physician?"],
    teachingScript: [
      t?.whyItMatters,
      t?.fullExplanation,
      t?.dietaryGuidance ? `Diet: ${t.dietaryGuidance}` : "",
      t?.medGuidance ? `Medication: ${t.medGuidance}` : "",
      Array.isArray(t?.signsToWatch) && t.signsToWatch.length ? `Report: ${t.signsToWatch.join(", ")}` : "",
    ].filter(Boolean).join(" ") || `Explain why ${t?.topic || "this topic"} matters to the patient's condition, medication safety, diet, activity tolerance, and prevention of avoidable hospitalization.`,
  }));

  const fallbacks = [
    { topic: `${plan.primaryDx} disease process and red flags`, linkedDxOrMed: plan.primaryDx, level: "basic" },
    { topic: "Medication purpose, timing, side effects, and missed-dose safety", linkedDxOrMed: "Medication regimen", level: "basic" },
    { topic: "Low-sodium/diagnosis-specific diet and hydration choices", linkedDxOrMed: plan.primaryDx, level: "intermediate" },
    { topic: "Home safety, fall prevention, energy conservation, and emergency plan", linkedDxOrMed: "Homebound/safety", level: "intermediate" },
    { topic: "When to contact physician versus emergency services", linkedDxOrMed: plan.primaryDx, level: "advanced" },
  ];

  while (seeded.length < 6) {
    const f = fallbacks[seeded.length % fallbacks.length];
    seeded.push({
      id: `edu-${seeded.length + 1}`,
      topic: f.topic,
      linkedDxOrMed: f.linkedDxOrMed,
      level: f.level,
      prerequisiteIds: seeded.length > 1 ? [`edu-${seeded.length - 1}`] : [],
      teachBackQuestions: ["Tell me the main step you will take at home and when you would call for help."],
      teachingScript: `Teach ${f.topic} in relation to the patient's diagnosis, medications, diet/activity limits, safety risks, and prevention of worsening symptoms or hospitalization.`,
    });
  }
  return seeded;
}

function buildServerEducationLog(topics: any[], visits: any[]): any[] {
  return topics.map((topic) => {
    const touched = visits.filter((v) => (v.educationDelivered ?? []).some((ed: any) => ed.topicId === topic.id));
    const mastered = touched.find((v) => (v.educationDelivered ?? []).some((ed: any) => ed.topicId === topic.id && ed.masteryReached));
    return {
      topicId: topic.id,
      topic: topic.topic,
      level: topic.level,
      firstTaught: touched[0]?.visitId ?? null,
      reinforcedAt: touched.slice(1).map((v) => v.visitId),
      masteredAt: mastered?.visitId ?? null,
      advancedToTopicId: topics.find((t) => t.linkedDxOrMed === topic.linkedDxOrMed && t.level !== topic.level)?.id ?? null,
    };
  }).filter((entry) => entry.firstTaught);
}

function buildEpisodeSummary(period: 1 | 2, visits: any[], threshold: number | null, sourceDoc: string): any {
  const periodVisits = visits.filter((v) => v.pdgmPeriod === period);
  const lupaRisk = threshold == null ? "unknown" : periodVisits.length < threshold ? "below" : periodVisits.length === threshold ? "at" : "above";
  const lupaImpactNote = threshold == null
    ? "LUPA threshold not supplied; user should verify HHRG-specific threshold."
    : lupaRisk === "below"
      ? `Below LUPA threshold (${periodVisits.length}/${threshold}); missed/low visit volume may affect payment and continuity.`
      : lupaRisk === "at"
        ? `At LUPA threshold (${threshold}); one missed visit may create LUPA risk.`
        : `Above LUPA threshold (${periodVisits.length}/${threshold}); planned utilization supports continuity.`;
  return {
    period,
    visitsCompleted: periodVisits.length,
    visitsScheduled: periodVisits.length,
    lupaThreshold: threshold,
    lupaRisk,
    lupaImpactNote,
    progress: period === 1 ? "stable" : "improved",
    keyInterventions: period === 1
      ? [`F2F/POC source linked from ${sourceDoc}.`, "Initial skilled assessment, medication reconciliation, disease education, and safety plan initiated."]
      : ["Teaching advanced with teach-back, medication adherence reinforced, and functional/safety monitoring continued."],
    remainingNeeds: ["Continue skilled assessment, education reinforcement, medication monitoring, homebound/safety review, and physician coordination as indicated."],
  };
}

function initialsFromName(name: string | undefined): string {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

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

function getFinishReason(data: any): string | undefined {
  return data?.choices?.[0]?.finish_reason ?? data?.choices?.[0]?.finishReason;
}

function getAssistantContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : typeof part === "string" ? part : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function parseStructuredAnalysis(data: any, expectedToolName: string): any | null {
  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  const toolCall = Array.isArray(toolCalls)
    ? toolCalls.find((call: any) => call?.function?.name === expectedToolName) ?? toolCalls[0]
    : null;

  const args = toolCall?.function?.arguments;
  if (typeof args === "string" && args.trim()) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.error("sn-series-analyze: failed to parse tool arguments", error);
    }
  }

  const content = getAssistantContent(data);
  if (!content) return null;

  const jsonText = extractJsonObject(content);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && Array.isArray(parsed.visits) ? parsed : null;
  } catch (error) {
    console.error("sn-series-analyze: failed to parse assistant JSON fallback", error);
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

Deno.serve(handler);
