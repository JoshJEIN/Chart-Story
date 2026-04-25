import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle,
  Download,
  ShieldCheck,
  ShieldAlert,
  ClipboardList,
  Stethoscope,
  GraduationCap,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { SnSeriesResult } from "@/types/snSeries";
import {
  generateSnSeriesBundle,
  generateSnSeriesEducationLogCsv,
  generateSnSeriesPreClaimChecklist,
  generateSnSeriesAuditQAJSON,
} from "@/lib/exportReports";

interface Props {
  result: SnSeriesResult;
}

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4 },
  }),
};

export default function SnVisitSeriesDisplay({ result }: Props) {
  const auditPass = result.longitudinalAudit?.pass !== false;
  const billable = result.preClaimChecklist?.billableDraftReady;

  return (
    <div className="space-y-6">
      {/* Downloads */}
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap gap-3 justify-center">
          <Button variant="outline" className="gap-2" onClick={() => generateSnSeriesBundle(result)}>
            <Download className="h-4 w-4" />
            Full Series Bundle
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSnSeriesEducationLogCsv(result)}>
            <Download className="h-4 w-4" />
            Education Log (CSV)
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSnSeriesPreClaimChecklist(result)}>
            <Download className="h-4 w-4" />
            Pre-Claim Checklist
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSnSeriesAuditQAJSON(result)}>
            <Download className="h-4 w-4" />
            Audit QA (JSON)
          </Button>
        </div>
      </motion.div>

      {/* Audit + Pre-Claim status */}
      <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
        <Card className={auditPass && billable ? "border-success/30" : "border-flag/40"}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {auditPass && billable ? (
                <ShieldCheck className="h-5 w-5 text-success" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-flag" />
              )}
              Longitudinal Audit & Pre-Claim Posture
              <Badge variant={auditPass ? "secondary" : "destructive"} className="ml-2 text-xs">
                {auditPass ? "AUDIT PASS" : "AUDIT FAIL"}
              </Badge>
              <Badge variant={billable ? "secondary" : "destructive"} className="text-xs">
                {billable ? "Billable Draft" : "Not Billable Yet"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Cert Period:</span>{" "}
              <span className="font-mono">
                {result.certPeriod?.startDate} → {result.certPeriod?.endDate}
              </span>{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="font-mono">{result.visits?.length ?? 0} visits</span>
            </p>
            <p>
              <span className="text-muted-foreground">Frequency order:</span>{" "}
              <span className="font-mono">{result.frequencyOrder?.raw}</span>{" "}
              <span className="text-muted-foreground">→</span>{" "}
              <span className="font-mono">{result.frequencyOrder?.totalVisitsScheduled} SN visits scheduled</span>
            </p>
            {result.longitudinalAudit?.failures?.length > 0 && (
              <div className="mt-2">
                <p className="font-semibold mb-1">Outstanding audit findings:</p>
                <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
                  {result.longitudinalAudit.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-mono">[{f.code}/{f.severity}]</span> {f.message}
                      {f.offendingVisitIds?.length > 0 && (
                        <span className="text-xs"> — visits: {f.offendingVisitIds.join(", ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.preClaimChecklist && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                {Object.entries(result.preClaimChecklist).filter(([k]) => k !== "notes").map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    {v === true ? (
                      <CheckCircle className="h-4 w-4 text-success shrink-0" />
                    ) : v === false ? (
                      <AlertTriangle className="h-4 w-4 text-flag shrink-0" />
                    ) : null}
                    <span className="font-mono">{k}</span>
                  </div>
                ))}
              </div>
            )}
            {result.preClaimChecklist?.notes && (
              <p className="text-xs text-muted-foreground italic mt-2">{result.preClaimChecklist.notes}</p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Episode summaries (per PDGM period) */}
      {result.episodeSummaries?.length > 0 && (
        <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-accent" />
                PDGM 30-Day Period Summaries
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {result.episodeSummaries.map((ep, i) => (
                <div key={i} className="rounded-md bg-secondary/50 border border-border p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">Period {ep.period}</Badge>
                    <span className="font-mono text-xs">
                      {ep.visitsCompleted} / {ep.visitsScheduled} visits
                    </span>
                    <Badge
                      variant={
                        ep.lupaRisk === "below"
                          ? "destructive"
                          : ep.lupaRisk === "at"
                          ? "outline"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      LUPA: {ep.lupaRisk}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{ep.progress}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{ep.lupaImpactNote}</p>
                  {ep.keyInterventions?.length > 0 && (
                    <p className="text-xs"><span className="text-muted-foreground">Key interventions:</span> {ep.keyInterventions.join(" · ")}</p>
                  )}
                  {ep.remainingNeeds?.length > 0 && (
                    <p className="text-xs"><span className="text-muted-foreground">Remaining needs:</span> {ep.remainingNeeds.join(" · ")}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Plan of Care (485-aligned, NO discharge planning) */}
      <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-accent" />
              Plan of Care (485-aligned)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Field label="Primary Dx" body={result.planOfCare?.primaryDx} />
            {result.planOfCare?.secondaryDx?.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Secondary Dx</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {result.planOfCare.secondaryDx.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            <Field label="Homebound Justification" body={result.planOfCare?.homeboundJustification} />
            <Field label="Skilled Need Rationale" body={result.planOfCare?.skilledNeedRationale} />
            {result.planOfCare?.measurableGoals?.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Measurable Goals (timed)</p>
                <ul className="list-disc pl-5 space-y-1">
                  {result.planOfCare.measurableGoals.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}
            {result.planOfCare?.disciplineOrders?.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Discipline Orders</p>
                <div className="space-y-2">
                  {result.planOfCare.disciplineOrders.map((d, i) => (
                    <div key={i} className="rounded-md bg-secondary/50 border border-border p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{d.discipline}</Badge>
                        <span className="text-xs font-mono text-muted-foreground">{d.frequencyDuration}</span>
                      </div>
                      <p className="text-sm">{d.interventions}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Field label="DME / Supplies" body={result.planOfCare?.dmeSupplies} />
          </CardContent>
        </Card>
      </motion.div>

      {/* Education Topics (flat) */}
      {result.educationTopics?.length > 0 && (
        <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-5 w-5 text-accent" />
                Education Topic Bank (Flat)
                <Badge variant="secondary" className="ml-2 text-xs">{result.educationTopics.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Topic</th>
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Linked Dx/Med</th>
                      <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Level</th>
                      <th className="text-left py-2 font-semibold text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.educationTopics.map((t) => {
                      const log = result.educationLog?.find((l) => l.topicId === t.id);
                      const status = log?.masteredAt
                        ? `mastered @ ${log.masteredAt}`
                        : log?.firstTaught
                        ? `taught @ ${log.firstTaught}, reinforced ${log.reinforcedAt?.length ?? 0}x`
                        : "not yet taught";
                      return (
                        <tr key={t.id} className="border-b border-border/50 align-top">
                          <td className="py-2 pr-4">{t.topic}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{t.linkedDxOrMed}</td>
                          <td className="py-2 pr-4"><Badge variant="outline" className="text-xs">{t.level}</Badge></td>
                          <td className="py-2 text-xs text-muted-foreground">{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Visits */}
      <motion.div custom={5} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-5 w-5 text-accent" />
              SN Visit Notes
              <Badge variant="secondary" className="ml-2 text-xs">{result.visits?.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="w-full">
              {result.visits?.map((v) => (
                <AccordionItem key={v.visitId} value={v.visitId}>
                  <AccordionTrigger className="text-sm">
                    <span className="text-left flex items-center gap-2 flex-wrap">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono">#{v.visitNumber}</span>
                      <span className="font-mono text-xs">{v.visitDate}</span>
                      <Badge variant="outline" className="text-xs">P{v.pdgmPeriod} · wk{v.weekOfEpisode}</Badge>
                      <Badge variant="outline" className="text-xs">{v.visitType}</Badge>
                      {v.flags?.length > 0 && (
                        <Badge variant="destructive" className="text-xs">{v.flags.length} flag</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <Field label="Subjective" body={v.subjective} />
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Objective ({v.objective?.timestamp})</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                        {v.objective?.bp && <div>BP: {v.objective.bp}</div>}
                        {v.objective?.hr != null && <div>HR: {v.objective.hr}</div>}
                        {v.objective?.rr != null && <div>RR: {v.objective.rr}</div>}
                        {v.objective?.spo2 != null && <div>SpO2: {v.objective.spo2}%</div>}
                        {v.objective?.temp != null && <div>T: {v.objective.temp}°F</div>}
                        {v.objective?.weight != null && <div>Wt: {v.objective.weight} lb</div>}
                        {v.objective?.fsbg != null && <div>FSBG: {v.objective.fsbg}</div>}
                        {v.objective?.painScore != null && <div>Pain: {v.objective.painScore}/10</div>}
                        {v.objective?.ambulationDistanceFt != null && <div>Amb: {v.objective.ambulationDistanceFt} ft</div>}
                      </div>
                      {v.objective?.wound && (
                        <p className="text-xs mt-2">
                          <span className="text-muted-foreground">Wound ({v.objective.wound.location}):</span>{" "}
                          {v.objective.wound.lengthCm}×{v.objective.wound.widthCm}×{v.objective.wound.depthCm} cm,{" "}
                          {v.objective.wound.tissueType}, {v.objective.wound.drainage}
                        </p>
                      )}
                    </div>
                    <Field label="Assessment" body={v.assessment} />
                    <ListField label="Planned Interventions" items={v.plannedInterventions} />
                    {v.educationDelivered?.length > 0 && (
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Education Delivered</p>
                        <ul className="list-disc pl-5 space-y-1 text-xs">
                          {v.educationDelivered.map((e, i) => {
                            const t = result.educationTopics?.find((tt) => tt.id === e.topicId);
                            return (
                              <li key={i}>
                                <span className="font-medium">{t?.topic ?? e.topicId}</span>{" "}
                                — comprehension {e.comprehensionPct}% {e.masteryReached && "· mastered"}
                                <div className="text-muted-foreground">{e.response}</div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    <Field label="Skilled Justification (this visit)" body={v.skilledJustification} />
                    <Field label="Homebound (restated for this visit)" body={v.homeboundRestated} />
                    {v.goalsProgress?.length > 0 && (
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Goals Progress</p>
                        <ul className="list-disc pl-5 space-y-0.5 text-xs">
                          {v.goalsProgress.map((g, i) => (
                            <li key={i}>
                              <Badge variant="outline" className="text-xs mr-1">{g.status}</Badge>
                              {g.goalRef} — {g.evidence}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {v.coordinationOfCare && <Field label="Coordination of Care" body={v.coordinationOfCare} />}
                    <Field label="Next Visit Focus" body={v.nextVisitFocus} />
                    {v.ggItemsTouched?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        GG items touched: {v.ggItemsTouched.join(", ")}
                      </p>
                    )}
                    {v.sources?.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Sources ({v.sources.length})</summary>
                        <ul className="list-disc pl-5 mt-1">
                          {v.sources.map((s, i) => (
                            <li key={i}><span className="font-mono">{s.field}</span> ← {s.sourceDoc}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {v.flags?.length > 0 && (
                      <div className="rounded-md bg-flag/5 border border-flag/15 p-2 text-xs">
                        {v.flags.map((f, i) => (
                          <div key={i}>
                            <Badge variant="destructive" className="text-xs mr-1">{f.severity}</Badge>
                            <span className="font-mono">{f.code}</span> — {f.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </motion.div>

      {/* Red flags */}
      {result.redFlags?.length > 0 && (
        <motion.div custom={6} variants={sectionVariants} initial="hidden" animate="visible">
          <Card className="border-flag/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-flag" />
                Series Red Flags
                <Badge variant="destructive" className="ml-2 text-xs">{result.redFlags.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {result.redFlags.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md bg-flag/5 border border-flag/15 p-3">
                    <Badge variant={f.severity === "high" ? "destructive" : "outline"} className="shrink-0 text-xs mt-0.5">
                      {f.severity}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{f.category}</p>
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function Field({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  );
}

function ListField({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">{label}</p>
      <ul className="list-disc pl-5 space-y-0.5 text-sm">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
