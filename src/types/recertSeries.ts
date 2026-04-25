// Recert Visit Series — types for subsequent (non-SOC) 60-day cert periods.
// Reuses SnVisitSeries shapes; adds fields that explain how this episode
// continues from the prior one (carry-forward, dropped, newly added topics).
import type { SnSeriesResult, SnEducationLogEntry, SnEducationTopic } from "@/types/snSeries";

export interface RecertEducationCarryForward {
  topicId: string;
  topic: string;
  level: SnEducationTopic["level"];
  reason: "in-progress" | "stalled";
}

export interface RecertEducationDropped {
  topicId: string;
  topic: string;
  reason: "mastered" | "no-longer-applicable";
  masteredAt: string | null;
}

export interface RecertSeriesResult extends SnSeriesResult {
  priorEpisodeRef: {
    certStartDate: string | null;
    certEndDate: string | null;
    visitsCompleted: number;
    summarySource: "auto-from-state" | "user-pasted-json" | "none";
  };
  educationCarriedForward: RecertEducationCarryForward[];
  educationDropped: RecertEducationDropped[];
  newDxAddressed: { dx: string; firstAddressedVisitId: string }[];
  priorEducationLog: SnEducationLogEntry[];
}
