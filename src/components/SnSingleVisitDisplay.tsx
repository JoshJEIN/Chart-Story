import { motion } from "framer-motion";
import {
  Stethoscope,
  GraduationCap,
  ClipboardList,
  AlertTriangle,
  Sparkles,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { SnSingleVisitDraft } from "@/types/snVisitDraft";

interface Props {
  draft: SnSingleVisitDraft;
}

export default function SnSingleVisitDisplay({ draft }: Props) {
  const v = draft.visit;
  const showVitals = draft.mode === "quick";

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-accent" />
                {draft.mode === "quick"
                  ? "Quick SN Visit Draft"
                  : "Recert Narrative SN Visit Draft"}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{v.visitDate}</Badge>
                <Badge variant="secondary">{v.visitType}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Section title="Subjective" body={v.subjective} />

            {showVitals ? (
              <ObjectiveBlock objective={v.objective} />
            ) : (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                Vitals are intentionally omitted in the recert narrative draft — they
                are captured in the Recert OASIS.
              </div>
            )}

            <Section title="Assessment" body={v.assessment} />

            <ListSection
              title="Planned Interventions"
              icon={<Stethoscope className="h-4 w-4" />}
              items={v.plannedInterventions}
            />

            <div>
              <SectionHeader icon={<GraduationCap className="h-4 w-4" />} title="Education Delivered" />
              {v.educationDelivered?.length ? (
                <Accordion type="multiple" className="mt-2">
                  {v.educationDelivered.map((e, i) => (
                    <AccordionItem key={i} value={`edu-${i}`}>
                      <AccordionTrigger className="text-sm">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{(e as any).topic ?? e.topicId}</span>
                          <Badge variant={e.masteryReached ? "default" : "outline"}>
                            {e.comprehensionPct}% {e.masteryReached ? "• mastered" : ""}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.response}</p>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No education entries.</p>
              )}
            </div>

            <Section title="Skilled Justification" body={v.skilledJustification} />
            {v.coordinationOfCare && (
              <Section title="Coordination of Care" body={v.coordinationOfCare} />
            )}

            {v.goalsProgress?.length > 0 && (
              <div>
                <SectionHeader icon={<ClipboardList className="h-4 w-4" />} title="Goals Progress" />
                <ul className="mt-1 space-y-1 text-sm">
                  {v.goalsProgress.map((g, i) => (
                    <li key={i} className="border-l-2 border-accent/40 pl-2">
                      <span className="font-medium">{g.goalRef}</span>{" "}
                      <Badge variant="outline" className="ml-1 text-xs">{g.status}</Badge>
                      <p className="text-xs text-muted-foreground">{g.evidence}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Section title="Next Visit Focus" body={v.nextVisitFocus} />
            <Section title="Homebound (visit-specific)" body={v.homeboundRestated} />

            {v.flags?.length > 0 && (
              <div>
                <SectionHeader icon={<AlertTriangle className="h-4 w-4 text-flag" />} title="Flags" />
                <ul className="mt-1 text-xs space-y-1">
                  {v.flags.map((f, i) => (
                    <li key={i}>
                      <Badge variant="outline" className="mr-1">{f.severity}</Badge>
                      <span className="font-mono">{f.code}</span> — {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-accent" />
              Source vs. AI-Expanded
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">{draft.provenanceNotes}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold mb-1">Your source notes</p>
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-xs">
                  {draft.inputExcerpt || "(no source excerpt)"}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1">Fields expanded by AI</p>
                {draft.addedFields?.length ? (
                  <ul className="text-xs list-disc ml-4 space-y-0.5">
                    {draft.addedFields.map((f, i) => (
                      <li key={i} className="font-mono">{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">All fields trace to the source.</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Review every expanded field before billing — strike anything not consistent with what occurred at the visit.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function Section({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    </div>
  );
}

function ListSection({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <SectionHeader icon={icon} title={title} />
      <ul className="mt-1 list-disc ml-5 text-sm space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function ObjectiveBlock({ objective }: { objective: any }) {
  if (!objective) return null;
  const rows: Array<[string, any]> = [
    ["Time", objective.timestamp],
    ["BP", objective.bp],
    ["HR", objective.hr],
    ["RR", objective.rr],
    ["SpO2", objective.spo2 != null ? `${objective.spo2}%` : undefined],
    ["Temp", objective.temp],
    ["Weight", objective.weight],
    ["FSBG", objective.fsbg],
    ["Pain", objective.painScore],
    ["Edema", objective.edema],
    ["Lung sounds", objective.lungSounds],
    ["Ambulation", objective.ambulationDistanceFt ? `${objective.ambulationDistanceFt} ft` : undefined],
    ["Transfer", objective.transferAssist],
  ].filter((row): row is [string, any] => row[1] !== undefined && row[1] !== null && row[1] !== "");
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-flag/40 bg-flag/5 p-3 text-xs text-flag">
        No objective data — nothing was extracted from your source notes. Add vitals at the bedside before billing.
      </div>
    );
  }
  return (
    <div>
      <SectionHeader icon={<Stethoscope className="h-4 w-4" />} title="Objective (from your source)" />
      <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border/50 py-0.5">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
