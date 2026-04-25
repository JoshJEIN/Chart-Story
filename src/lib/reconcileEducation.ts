// Reconcile education topics between a prior SN series episode and a fresh SOC-style
// seed produced from the recertification packet. Drops mastered, carries forward in-progress,
// adds new topics seeded from the new episode's POC/dx/meds.
import type { SnEducationLogEntry, SnEducationTopic } from "@/types/snSeries";
import type {
  RecertEducationCarryForward,
  RecertEducationDropped,
} from "@/types/recertSeries";

export interface ReconcileResult {
  topics: SnEducationTopic[];
  carriedForward: RecertEducationCarryForward[];
  dropped: RecertEducationDropped[];
}

export function reconcileEducation(
  priorTopics: SnEducationTopic[],
  priorLog: SnEducationLogEntry[],
  newSeedTopics: SnEducationTopic[],
): ReconcileResult {
  const logById = new Map(priorLog.map((e) => [e.topicId, e]));
  const carriedForward: RecertEducationCarryForward[] = [];
  const dropped: RecertEducationDropped[] = [];

  const carriedTopics: SnEducationTopic[] = [];
  for (const t of priorTopics) {
    const log = logById.get(t.id);
    const mastered = log?.masteredAt != null;
    if (mastered) {
      dropped.push({
        topicId: t.id,
        topic: t.topic,
        reason: "mastered",
        masteredAt: log!.masteredAt,
      });
      continue;
    }
    const inProgress = log?.firstTaught != null;
    carriedForward.push({
      topicId: t.id,
      topic: t.topic,
      level: t.level,
      reason: inProgress ? "in-progress" : "stalled",
    });
    carriedTopics.push(t);
  }

  // Add genuinely new topics from the new seed (id collision = treat as same topic).
  const existingIds = new Set(carriedTopics.map((t) => t.id));
  const additions = newSeedTopics.filter((t) => !existingIds.has(t.id));

  return {
    topics: [...carriedTopics, ...additions],
    carriedForward,
    dropped,
  };
}
