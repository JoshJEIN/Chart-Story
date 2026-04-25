// Deterministic post-LLM education advancement and log builder.
// Recomputes educationLog from visits[].educationDelivered and enforces:
//  - mastery requires comprehension >= 80% on 2 separate visits
//  - a topic at the same level cannot be the *primary* focus on 3+ consecutive
//    visits unless masteryReached=false with documented stalled comprehension.
import type {
  SnVisit,
  SnEducationTopic,
  SnEducationLogEntry,
} from "@/types/snSeries";

export function buildEducationLog(
  topics: SnEducationTopic[],
  visits: SnVisit[],
): SnEducationLogEntry[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const log = new Map<string, SnEducationLogEntry>();

  // Initialize entries for every topic actually touched.
  for (const v of visits) {
    for (const ed of v.educationDelivered ?? []) {
      if (!log.has(ed.topicId)) {
        const t = byId.get(ed.topicId);
        log.set(ed.topicId, {
          topicId: ed.topicId,
          topic: t?.topic ?? ed.topicId,
          level: t?.level ?? "basic",
          firstTaught: null,
          reinforcedAt: [],
          masteredAt: null,
          advancedToTopicId: null,
        });
      }
    }
  }

  // Walk visits in order.
  const masteryHits = new Map<string, number>();
  for (const v of visits) {
    for (const ed of v.educationDelivered ?? []) {
      const entry = log.get(ed.topicId)!;
      if (!entry.firstTaught) entry.firstTaught = v.visitId;
      else entry.reinforcedAt.push(v.visitId);

      if (ed.comprehensionPct >= 80) {
        masteryHits.set(ed.topicId, (masteryHits.get(ed.topicId) ?? 0) + 1);
        if (masteryHits.get(ed.topicId)! >= 2 && !entry.masteredAt) {
          entry.masteredAt = v.visitId;
          // Find a next-level topic in the same domain (linkedDxOrMed match).
          const t = byId.get(ed.topicId);
          if (t) {
            const next = topics.find(
              (n) =>
                n.linkedDxOrMed === t.linkedDxOrMed &&
                n.level !== t.level &&
                ((t.level === "basic" && n.level === "intermediate") ||
                  (t.level === "intermediate" && n.level === "advanced")),
            );
            if (next) entry.advancedToTopicId = next.id;
          }
        }
      }
    }
  }

  return Array.from(log.values());
}

export interface RepetitionViolation {
  topicId: string;
  visitIds: string[];
}

// Returns violations of the "same topic primary on 3+ consecutive visits without
// documented stall" rule. Primary = first item in educationDelivered for that visit.
export function findEducationRepetitionViolations(visits: SnVisit[]): RepetitionViolation[] {
  const violations: RepetitionViolation[] = [];
  let run: { topicId: string; ids: string[] } | null = null;

  for (const v of visits) {
    const primary = v.educationDelivered?.[0];
    if (!primary) {
      run = null;
      continue;
    }
    // A "stall" excuses repetition: comprehensionPct < 60 documented as not progressing.
    const stalled = primary.comprehensionPct < 60 && /stall|no progress|no change|regress/i.test(primary.response);

    if (run && run.topicId === primary.topicId && !stalled) {
      run.ids.push(v.visitId);
    } else {
      run = { topicId: primary.topicId, ids: [v.visitId] };
    }

    if (run.ids.length >= 3) {
      violations.push({ topicId: run.topicId, visitIds: [...run.ids] });
      run = null;
    }
  }
  return violations;
}
