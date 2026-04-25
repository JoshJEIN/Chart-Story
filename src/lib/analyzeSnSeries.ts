import { supabase } from "@/integrations/supabase/client";
import type { SocAnalysisResult } from "@/types/soc";
import type {
  CertPeriod,
  FrequencyOrder,
  SnSeriesResult,
  SnVerbalOrder,
} from "@/types/snSeries";
import { buildVisitSchedule } from "@/lib/parseFrequency";
import { buildEducationLog, findEducationRepetitionViolations } from "@/lib/educationAdvancement";
import { auditObjectiveFindings } from "@/lib/objectiveFindingsAudit";

interface AnalyzeOptions {
  maxIterations?: number;
  lupaThresholds?: { period1?: number | null; period2?: number | null };
  expectedFrequencyFromPOC?: string | null;
  verbalOrder?: SnVerbalOrder | null;
}

export async function analyzeSnVisitSeries(
  socResult: SocAnalysisResult,
  certPeriod: CertPeriod,
  frequencyOrder: FrequencyOrder,
  options: AnalyzeOptions = {},
): Promise<SnSeriesResult> {
  const schedule = buildVisitSchedule(certPeriod.startDate, frequencyOrder.parsed);

  const { data, error } = await supabase.functions.invoke("sn-series-analyze", {
    body: {
      socResult,
      schedule,
      certPeriod,
      frequencyOrder,
      lupaThresholds: options.lupaThresholds ?? null,
      maxIterations: options.maxIterations,
      expectedFrequencyFromPOC: options.expectedFrequencyFromPOC ?? null,
      verbalOrder: options.verbalOrder ?? null,
    },
  });

  if (error) throw new Error(error.message || "SN series analysis failed");

  const result = data as SnSeriesResult & { _auditMeta?: SnSeriesResult["auditMeta"] };

  // Deterministic post-processing: rebuild education log + run anti-clone comparator,
  // merge any deterministic failures into the longitudinal audit.
  const visits = result.visits ?? [];
  const educationTopics = result.educationTopics ?? [];

  const recomputedLog = buildEducationLog(educationTopics, visits);
  const cloneFailures = auditObjectiveFindings(visits);
  const repetitionViolations = findEducationRepetitionViolations(visits);

  const repetitionFailures = repetitionViolations.map((r) => ({
    code: "EDU_REPETITION_3PLUS",
    severity: "medium" as const,
    message: `Topic ${r.topicId} taught as primary on 3+ consecutive visits without documented stall.`,
    offendingVisitIds: r.visitIds,
  }));

  // Deterministic POC frequency match check (mirrors edge audit criterion k).
  const freqFailures: SnSeriesResult["longitudinalAudit"]["failures"] = [];
  if (
    options.expectedFrequencyFromPOC &&
    options.expectedFrequencyFromPOC.trim() !== frequencyOrder.raw.trim() &&
    !options.verbalOrder
  ) {
    freqFailures.push({
      code: "FREQ_POC_MISMATCH",
      severity: "high",
      message: `Frequency "${frequencyOrder.raw}" does not match physician-ordered frequency "${options.expectedFrequencyFromPOC}" and no verbal order was supplied.`,
      offendingVisitIds: [],
    });
  }

  const mergedFailures = [
    ...(result.longitudinalAudit?.failures ?? []),
    ...cloneFailures,
    ...repetitionFailures,
    ...freqFailures,
  ];

  return {
    ...result,
    expectedFrequencyFromPOC: options.expectedFrequencyFromPOC ?? null,
    verbalOrder: options.verbalOrder ?? null,
    educationLog: recomputedLog,
    longitudinalAudit: {
      pass: mergedFailures.length === 0,
      failures: mergedFailures,
    },
    auditMeta: result._auditMeta ?? result.auditMeta,
    generatedAt: new Date(),
  };
}
