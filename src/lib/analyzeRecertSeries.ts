import { supabase } from "@/integrations/supabase/client";
import type {
  CertPeriod,
  FrequencyOrder,
  SnSeriesResult,
  SnVerbalOrder,
} from "@/types/snSeries";
import type { RecertSeriesResult } from "@/types/recertSeries";
import { buildVisitSchedule } from "@/lib/parseFrequency";
import { buildEducationLog, findEducationRepetitionViolations } from "@/lib/educationAdvancement";
import { auditObjectiveFindings } from "@/lib/objectiveFindingsAudit";

interface AnalyzeOptions {
  maxIterations?: number;
  lupaThresholds?: { period1?: number | null; period2?: number | null };
  verbalOrder?: SnVerbalOrder | null;
  priorSeries?: SnSeriesResult | null;
}

interface ParsedDoc { name: string; text: string; }

export async function analyzeRecertVisitSeries(
  documents: ParsedDoc[],
  certPeriod: CertPeriod,
  frequencyOrder: FrequencyOrder,
  options: AnalyzeOptions = {},
): Promise<RecertSeriesResult> {
  const schedule = buildVisitSchedule(certPeriod.startDate, frequencyOrder.parsed);

  const { data, error } = await supabase.functions.invoke("recert-series-analyze", {
    body: {
      documents,
      schedule,
      certPeriod,
      frequencyOrder,
      lupaThresholds: options.lupaThresholds ?? null,
      maxIterations: options.maxIterations,
      verbalOrder: options.verbalOrder ?? null,
      priorSeries: options.priorSeries ?? null,
    },
  });

  if (error) throw new Error(error.message || "Recert series analysis failed");

  const result = data as RecertSeriesResult & { _auditMeta?: SnSeriesResult["auditMeta"] };

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

  // Deterministic check: no mastered prior topic appears as primary in any new visit.
  const masteredIds = new Set(
    (options.priorSeries?.educationLog ?? [])
      .filter((e) => !!e.masteredAt)
      .map((e) => e.topicId),
  );
  const masteryViolations: { code: string; severity: "high"; message: string; offendingVisitIds: string[] }[] = [];
  for (const v of visits) {
    const primary = v.educationDelivered?.[0];
    if (primary && masteredIds.has(primary.topicId)) {
      masteryViolations.push({
        code: "RECERT_MASTERED_TOPIC_RETAUGHT",
        severity: "high",
        message: `Topic ${primary.topicId} was mastered in the prior episode but is being re-taught as primary on visit ${v.visitId}.`,
        offendingVisitIds: [v.visitId],
      });
    }
  }

  const mergedFailures = [
    ...(result.longitudinalAudit?.failures ?? []),
    ...cloneFailures,
    ...repetitionFailures,
    ...masteryViolations,
  ];

  return {
    ...result,
    educationLog: recomputedLog,
    longitudinalAudit: {
      pass: mergedFailures.length === 0,
      failures: mergedFailures,
    },
    priorEpisodeRef: {
      certStartDate: options.priorSeries?.certPeriod?.startDate ?? null,
      certEndDate: options.priorSeries?.certPeriod?.endDate ?? null,
      visitsCompleted: options.priorSeries?.visits?.length ?? 0,
      summarySource: options.priorSeries ? "auto-from-state" : "none",
    },
    priorEducationLog: options.priorSeries?.educationLog ?? [],
    auditMeta: result._auditMeta ?? result.auditMeta,
    generatedAt: new Date(),
  };
}
