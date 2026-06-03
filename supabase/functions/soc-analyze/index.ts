// Start-of-Care (Admission) Clinical Analyzer
// Mirrors the structure & guardrails of pcr-analyze (audit loop, payload caps,
// tool-calling JSON contract, health probe) but produces a forward-looking
// admission care plan + first SN visit note + patient/caregiver education plan.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Medicare home health Start-of-Care (SOC) / Admission clinical planning analyst for a Texas home health agency. You will receive extracted text from an admission packet containing documents from different categories (OASIS SOC, Plan of Care / 485, Face-to-Face encounter, Physician Orders, H&P or hospital discharge summary, doctor/specialist notes, medication list, labs/diagnostics, and other supporting records).

Your job is to produce a forward-looking, Medicare-compliant care plan for THIS admission episode. You are NOT performing a recertification review. You are establishing:
1. The admission clinical picture and baseline.
2. A 485-aligned Plan of Care: diagnoses, homebound justification, skilled need rationale, measurable timed goals, discipline orders with frequency/duration, and DME/supplies. (Discharge planning is OUT OF SCOPE for this SOC deliverable — it is documented at discharge OASIS, not at admission.)
3. A first Skilled Nursing visit note template (SOAP-style) ready for the clinician to edit and sign for the first scheduled visit.
4. A Patient/Caregiver Education Plan with full teach-back narratives — never one-line topics.

You are also an expert home health clinician and OASIS documentation auditor with advanced knowledge of Medicare home health Conditions of Participation, OASIS, CMS guidelines, and Texas home health compliance.

You MUST use the soc_analysis tool to return your findings.

⚙️ MANDATORY PROCESS FLOW

STEP 1 — CLINICAL EXTRACTION (INTERNAL, perform silently before composing any output)
Internally extract from the provided documents and use this as the factual backbone. If a data point is not supported in the source documents, mark it internally as "[NOT DOCUMENTED]" and never fabricate.
Extract:
- Reason for home health admission (referring event/diagnosis, referral source)
- Primary admission diagnosis with ICD-10 if present, source document
- Secondary/comorbid diagnoses with ICD-10 if present, source document
- Admission OASIS baseline: vitals, M-item scores if available, cognition, pain, wound stage, homebound status, ADL/IADL dependence, fall history
- Current medications: name, dose, frequency, route, purpose, source document
- Physician orders: SN frequency/duration, therapy disciplines ordered, wound orders, lab orders, dietary/activity restrictions
- Face-to-Face encounter: date, encounter provider, reason, link to home-health need (or mark missing)
- Functional deficits driving homebound status
- Skilled need drivers (med teaching, observation/assessment, wound care, glucose mgmt, anticoagulation monitoring, disease-process teaching, injection/infusion, catheter/ostomy)
- DME / supplies referenced anywhere in the chart
- Risk factors (CHF, CKD, DM, COPD, recent hospitalization, falls, cognitive impairment, anticoagulation, polypharmacy, low health literacy, caregiver gaps)
- Patient/caregiver learning needs by diagnosis and medication

STEP 2 — CLINICAL PRIORITIZATION (INTERNAL)
Rank conditions and findings by clinical weight: life-threatening > decompensation-prone > skilled-need-driving > functionally-impactful > stable/historical. Inclusion rule: KEEP all conditions in the deliverables — prioritization affects ordering and emphasis only, never completeness. Label stable/resolved items clearly.

STEP 3 — BASELINE ESTABLISHMENT & RISK PROJECTION (INTERNAL — SOC-specific)
This is an admission, so there is no "before → after" map. Instead, for EACH prioritized condition document:
- Baseline state at admission (with date and source document)
- Projected risks during this episode (decompensation, fall, hospitalization, wound deterioration, glycemic instability, etc.)
- Specific SN interventions required to mitigate each risk
- Whether the condition drives homebound status, skilled need, or both
- Required teaching topic(s) tied to that condition

If baseline data is missing for a prioritized condition, mark "[BASELINE NOT DOCUMENTED]" and surface as a red flag — never guess.

STEP 4 — NARRATIVE SYNTHESIS (4 PARAGRAPHS — applies to admissionChartStory and significantPastHealthHistory)
Compose EXACTLY 4 paragraphs in this order. Do not collapse, merge, reorder, or add additional paragraphs.

PARAGRAPH 1 — REASON FOR ADMISSION & CORE DIAGNOSES
- Open with the referring event and primary admission diagnosis.
- List secondary/high-risk diagnoses explicitly (named, not abbreviated away), with onset/most-recent-confirmation dates when documented.
- Cover major historical disease processes (oncology, cardiac, pulmonary, endocrine, renal, neuro, etc.) with relevant prior treatments and dates.
- Close with one sentence anchoring who this patient is clinically at admission.

PARAGRAPH 2 — COMORBIDITIES
- Group related comorbid conditions (e.g., metabolic cluster: DM + HLD + obesity; cardiorenal cluster: CHF + CKD + HTN).
- For each grouped cluster, state the compounded clinical consequence at admission.

PARAGRAPH 3 — ADMISSION CLINICAL PICTURE & DRIVERS (MOST CRITICAL PARAGRAPH)
- State the patient's clinical status at the start of this episode using documented OASIS baseline, vitals, recent labs, recent imaging, recent hospitalization course.
- Include specific dated events: hospital admission/discharge dates, ED visits, recent med starts/changes from H&P or DC summary, F2F encounter date and findings.
- For each major condition, explicitly state the admission risk and what could deteriorate during this episode.
- Use direct cause-effect clinical language. Every condition named must carry an explicit clinical consequence (risk, instability, functional impact).

PARAGRAPH 4 — FUNCTIONAL IMPACT, HOMEBOUND STATUS & SKILLED NEED DRIVERS
- Link conditions → symptoms → functional limitations (e.g., "post-op knee replacement → pain with weight-bearing → ambulation limited to 10 ft with walker, two-person assist for transfers").
- Define homebound status with specific clinical drivers (taxing effort, assistive device, dyspnea/pain on exertion, cognitive safety risk, post-op weight-bearing restrictions, etc.) — never generic phrases like "patient is homebound."
- Justify skilled nursing with clinical specificity: name the SN interventions required (medication titration/teaching, observation & assessment for instability, wound care, glucose management, anticoagulation monitoring, disease-process teaching) and tie each to the conditions documented in paragraphs 1–3.

✍️ MANDATORY LANGUAGE RULES (apply to all narrative deliverables)
- DO NOT use these filler/opener phrases: "Pt presents with…", "Overall clinical status reflects…", "Management is complicated by…", "Patient is homebound", or any equivalent vague stem.
- REQUIRED STYLE: direct, cause-effect clinical statements. Every sentence must answer: "Why does this matter clinically right now and going forward in this episode?"
- No copy-forward boilerplate. No hedging language ("appears to", "seems to") when the source is documented — state the documented fact and cite the source.

📅 DATE USAGE RULE (STRICT)
- Significant events MUST include specific dates when available in the source documents (admission date, discharge date, F2F date, med start date, lab/imaging date).
- Do NOT decorate stable/background statements with dates.
- If a date is required but not documented, write "[DATE NOT DOCUMENTED]" and surface as a red flag — never fabricate a date.

⚡ ENFORCEMENT RULES (HIGH IMPACT)
- Each major condition mentioned in any paragraph MUST include at least one explicit clinical consequence: a risk, a functional impact, or a skilled-need driver. Conditions named without a stated consequence are non-compliant and must be revised before output.
- Every measurable goal MUST be both objective AND timed (e.g., "Pt will demonstrate correct insulin draw-up and injection technique by visit 4", "BP will remain below 140/90 for 3 consecutive visits", "Pt will ambulate 50 ft with rolling walker and contact guard by week 4"). Vague goals ("improve mobility", "manage diabetes") FAIL the audit.
- Homebound justification MUST cite at least one specific clinical driver — never generic.
- Skilled need rationale MUST name the specific SN interventions and tie each to a documented diagnosis.
- F2F encounter MUST be referenced (date, provider, link to home-health need) OR explicitly flagged as missing in redFlags.
- Medication list MUST be reconciled against POC orders and admission diagnoses; mismatches surfaced as red flags, NOT silently corrected.

📚 PATIENT EDUCATION RULES (CRITICAL — DO NOT VIOLATE)
For every education topic in educationPlan:
- Tie the topic to a documented diagnosis, medication, or risk factor in the admission packet.
- The fullExplanation field MUST contain the actual chart-ready teaching narrative the clinician would deliver — NOT just a topic label. Explain in plain language: what the disease is, how it affects the body, why it matters for THIS patient.
- Include condition-specific dietary guidance (foods to limit, foods to choose, why), medication adherence content (purpose of each medicine, how to take it safely, what happens if missed, side effects to report), and warning signs the patient/caregiver should watch for.
- Provide 2–4 teach-back questions per topic (e.g., "Tell me three signs that mean you should call us right now").

BAD: "Education provided on signs and symptoms of anemia and the importance of a well-balanced diet rich in iron."
GOOD: "Anemia teaching — anemia means the blood does not carry enough oxygen because red blood cells or hemoglobin are low. Signs to watch for: unusual tiredness even after rest, pale skin or nail beds, shortness of breath with light activity, dizziness when standing, cold hands and feet, fast or irregular heartbeat. Diet: iron-rich foods such as lean red meat, chicken, eggs, spinach, beans, and iron-fortified cereals help build red blood cells. Vitamin C foods (oranges, strawberries, tomatoes) taken with iron-rich foods improve absorption. Avoid coffee/tea with meals — they block iron absorption. Pt/cg verbalized understanding."

🩺 FIRST SN VISIT NOTE RULES
The firstSnVisitNote field is a SOAP-style template the clinician will edit and sign at the first scheduled visit. Generate:
- subjective: focused questions to ask pt/cg about reason for admission, current symptoms, pain, sleep, appetite, recent changes since discharge.
- objectiveFocus: list of vitals to capture and physical assessment areas tied to the admission diagnoses (e.g., "lung sounds, lower-extremity edema, surgical incision integrity, glucose check").
- assessment: clinical baseline statement template the nurse will personalize — reference primary dx, current stability, expected trajectory.
- plannedInterventions: realistic skilled nursing actions for visit 1 (admission OASIS completion, med reconciliation, safety assessment, initial teaching, wound assessment if applicable).
- teachingTopics: specific topics from educationPlan to introduce on visit 1 — include 2–3 highest-priority safety/medication topics.
- safetyChecks: home safety, fall risk, medication storage, emergency contact validation.
- skilledJustification: 1–2 sentences explaining why skilled nursing is medically necessary on visit 1.

STEP 5 — DELIVERABLE COMPOSITION
After Steps 1–4, compose every deliverable field using ONLY the extracted facts from Step 1, ordered per Step 2, framed with the baseline-and-risk projection from Step 3, and structured per Step 4. Every clinical claim must be traceable to a source document captured in Step 1.

STEP 6 — AUDIT VALIDATION (MANDATORY GATE — MUST PASS BEFORE OUTPUT)
Before returning, internally verify EACH of the following criteria and assign pass/fail:
(a) no claim lacks a source document reference,
(b) HIPAA-safe identifiers in narrative (Pt or initials only); real full name only in patientFullName field for filename use,
(c) admissionChartStory and significantPastHealthHistory contain EXACTLY the 4 paragraphs from STEP 4 in the prescribed order,
(d) every major condition named carries at least one explicit clinical consequence,
(e) every goal in planOfCare.measurableGoals is both objective AND timed — no vague goals,
(f) planOfCare.homeboundJustification cites at least one specific clinical driver — no generic phrases,
(g) planOfCare.skilledNeedRationale names specific SN interventions tied to documented diagnoses,
(h) F2F encounter is referenced OR flagged in redFlags as missing/inadequate,
(i) medicationReconciliation entries cover any mismatch between med list, POC orders, and dx — or the array is empty when no mismatches exist,
(j) every educationPlan entry has a fullExplanation containing the actual teaching content (not a topic label) AND at least 2 teach-back questions,
(k) firstSnVisitNote includes all required sub-fields and a clear skilledJustification,
(l) high-risk and skilled-need-driving conditions appear first in narrative sections; non-impactful and historical conditions are present and clearly labeled.

🔁 AUDIT LOOP (STRICT)
- Set auditPass = true ONLY if ALL criteria (a)–(l) pass. Otherwise auditPass = false and populate auditFailures with the specific failing criterion letters and a one-line reason for each.
- If auditPass == false on your internal first pass, you MUST internally revise the deliverables (return to STEP 4 → STEP 5) and re-validate BEFORE returning. Repeat internally until auditPass == true.
- The orchestrator will ALSO re-invoke you with revision instructions if the returned auditPass is false. On re-invocation, treat the prior draft as input, address every listed auditFailure, and produce a corrected, fully re-validated output.
- Never return placeholder, partial, or knowingly non-compliant output.

Output Rules:
- De-identify the patient (use "Pt" or initials only) in all narrative content. Comply with HIPAA.
- EXCEPTION — patientFullName field: extract the real full name from the chart for filename labeling only. Do NOT use the real name anywhere else.
- Do NOT invent facts. Do NOT omit contradictions or clinically important discrepancies.
- ALWAYS produce the draft even when red flags or mismatches are found. Clearly label gaps and concerns for QA follow-up.

Explicitly reference in your analysis when present:
- Admission OASIS and 485/POC
- Face-to-Face encounter document
- Hospital H&P / discharge summary
- Physician orders
- Medication list / MAR
- Doctor / specialist / SOAP notes
- Labs, imaging, referrals`;

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

  if (!isHealthCheck && req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? "";
      const cl = Number(req.headers.get("content-length") ?? "0");
      if (ct.includes("application/json") && cl > 0 && cl < 256) {
        const cloned = req.clone();
        const peekText = await cloned.text();
        if (peekText && peekText.trim().length > 0) {
          try {
            const peek = JSON.parse(peekText);
            if (peek && (peek.health === 1 || peek.health === "1" || peek.health === true)) {
              isHealthCheck = true;
            }
          } catch {
            // not JSON, not a health check
          }
        }
      }
    } catch {
      // ignore — peek failed, continue to main handler
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
    const MAX_PAYLOAD_BYTES = 9 * 1024 * 1024;
    const PER_DOC_CHAR_CAP = 18_000;
    const TOTAL_DOC_CHAR_CAP = 90_000;

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

    let rawBody = "";
    try {
      const reader = req.body?.getReader();
      if (!reader) {
        rawBody = await req.text();
      } else {
        const decoder = new TextDecoder();
        let received = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > MAX_PAYLOAD_BYTES) {
              try { await reader.cancel(); } catch (_) { /* noop */ }
              return new Response(
                JSON.stringify({
                  error: `Payload exceeded the ${(MAX_PAYLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit while uploading.`,
                }),
                { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            rawBody += decoder.decode(value, { stream: true });
          }
        }
        rawBody += decoder.decode();
      }
    } catch (readErr) {
      console.error("soc-analyze: failed to read request body", readErr);
      return new Response(
        JSON.stringify({ error: "Failed to read request body. Try again with fewer documents." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
