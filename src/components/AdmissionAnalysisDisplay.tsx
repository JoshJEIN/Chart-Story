import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle,
  FileSearch,
  Table,
  Download,
  Pill,
  User,
  History,
  ShieldCheck,
  ShieldAlert,
  ClipboardList,
  Stethoscope,
  GraduationCap,
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
import { SocAnalysisResult } from "@/types/soc";
import {
  generateSocAdmissionChartStory,
  generateSocPlanOfCareReport,
  generateSocFirstVisitNote,
  generateSocEducationPlan,
  generateSocAuditQAJSON,
} from "@/lib/exportReports";

interface Props {
  result: SocAnalysisResult;
}

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4 },
  }),
};

export default function AdmissionAnalysisDisplay({ result }: Props) {
  return (
    <div className="space-y-6">
      {/* Download Buttons */}
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap gap-3 justify-center">
          <Button variant="outline" className="gap-2" onClick={() => generateSocAdmissionChartStory(result)}>
            <Download className="h-4 w-4" />
            Admission Chart Story
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSocPlanOfCareReport(result)}>
            <Download className="h-4 w-4" />
            Plan of Care (485-aligned)
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSocFirstVisitNote(result)}>
            <Download className="h-4 w-4" />
            First SN Visit Note
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSocEducationPlan(result)}>
            <Download className="h-4 w-4" />
            Education Plan
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => generateSocAuditQAJSON(result)}>
            <Download className="h-4 w-4" />
            Audit QA (JSON)
          </Button>
        </div>
      </motion.div>

      {/* Audit Meta */}
      {(result.auditMeta || result.auditPass !== undefined) && (
        <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
          <Card className={result.auditMeta?.finalAuditPass === false ? "border-flag/40" : "border-success/30"}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {result.auditMeta?.finalAuditPass === false ? (
                  <ShieldAlert className="h-5 w-5 text-flag" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-success" />
                )}
                Admission Audit Loop Result
                <Badge
                  variant={result.auditMeta?.finalAuditPass === false ? "destructive" : "secondary"}
                  className="ml-2 text-xs"
                >
                  {result.auditMeta?.finalAuditPass === false ? "FAIL" : "PASS"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Episode:</span>{" "}
                <span className="font-mono">{result.episodeInfo?.episodeLabel ?? "—"}</span>{" "}
                <span className="text-muted-foreground">·</span>{" "}
                <span className="font-mono">{result.episodeInfo?.certPeriodDates ?? "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Iterations used:</span>{" "}
                <span className="font-mono">
                  {result.auditMeta?.iterations ?? "—"} of {result.auditMeta?.maxIterations ?? "—"}
                </span>
              </p>
              {result.auditMeta?.remainingFailures && result.auditMeta.remainingFailures.length > 0 && (
                <div className="mt-2">
                  <p className="font-semibold mb-1">Remaining failures:</p>
                  <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
                    {result.auditMeta.remainingFailures.map((f, i) => (
                      <li key={i}>
                        <span className="font-mono">({f.criterion})</span> {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Significant Past Health History */}
      {result.significantPastHealthHistory && (
        <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-5 w-5 text-accent" />
                Significant Past Health History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-body text-sm leading-relaxed">
                {result.significantPastHealthHistory}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Admission Chart Story */}
      <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-5 w-5 text-accent" />
              Admission Chart Story
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-body text-sm leading-relaxed">
              {result.admissionChartStory}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Plan of Care */}
      <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-accent" />
              Plan of Care (485-aligned)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Primary Dx</p>
              <p>{result.planOfCare?.primaryDx}</p>
            </div>
            {result.planOfCare?.secondaryDx?.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Secondary Dx</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {result.planOfCare.secondaryDx.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Homebound Justification</p>
              <p className="whitespace-pre-wrap leading-relaxed">{result.planOfCare?.homeboundJustification}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Skilled Need Rationale</p>
              <p className="whitespace-pre-wrap leading-relaxed">{result.planOfCare?.skilledNeedRationale}</p>
            </div>
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
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">DME / Supplies</p>
              <p>{result.planOfCare?.dmeSupplies}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Discharge Planning</p>
              <p className="whitespace-pre-wrap leading-relaxed">{result.planOfCare?.dischargePlanning}</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* First SN Visit Note */}
      <motion.div custom={5} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-5 w-5 text-accent" />
              First SN Visit Note Template
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Section label="Subjective" body={result.firstSnVisitNote?.subjective} />
            <ListSection label="Objective Focus" items={result.firstSnVisitNote?.objectiveFocus} />
            <Section label="Assessment" body={result.firstSnVisitNote?.assessment} />
            <ListSection label="Planned Interventions" items={result.firstSnVisitNote?.plannedInterventions} />
            <ListSection label="Teaching Topics (Visit 1)" items={result.firstSnVisitNote?.teachingTopics} />
            <ListSection label="Safety Checks" items={result.firstSnVisitNote?.safetyChecks} />
            <Section label="Skilled Justification" body={result.firstSnVisitNote?.skilledJustification} />
          </CardContent>
        </Card>
      </motion.div>

      {/* Education Plan */}
      {result.educationPlan?.length > 0 && (
        <motion.div custom={6} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-5 w-5 text-accent" />
                Patient / Caregiver Education Plan
                <Badge variant="secondary" className="ml-2 text-xs">{result.educationPlan.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full">
                {result.educationPlan.map((edu, i) => (
                  <AccordionItem key={i} value={`edu-${i}`}>
                    <AccordionTrigger className="text-sm font-medium">
                      <span className="text-left">
                        {edu.topic}{" "}
                        <span className="text-muted-foreground font-normal">— {edu.linkedDiagnosisOrMed}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <Section label="Why it matters" body={edu.whyItMatters} />
                      <Section label="Full explanation (chart-ready)" body={edu.fullExplanation} />
                      <ListSection label="Signs to watch for" items={edu.signsToWatch} />
                      <Section label="Dietary guidance" body={edu.dietaryGuidance} />
                      <Section label="Medication guidance" body={edu.medGuidance} />
                      <ListSection label="Teach-back questions" items={edu.teachBackQuestions} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Medication Reconciliation */}
      {result.medicationReconciliation?.length > 0 && (
        <motion.div custom={7} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Pill className="h-5 w-5 text-accent" />
                Medication Reconciliation
                <Badge variant="secondary" className="ml-2 text-xs">{result.medicationReconciliation.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {result.medicationReconciliation.map((m, i) => (
                  <div key={i} className="rounded-md bg-secondary/50 border border-border p-3">
                    <p className="text-sm font-semibold">{m.medication}</p>
                    <p className="text-sm text-muted-foreground mt-1">Issue: {m.issue}</p>
                    <p className="text-sm text-muted-foreground">Recommendation: {m.recommendation}</p>
                    <p className="text-xs text-muted-foreground mt-1">Source: {m.sourceDocument}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Red Flags */}
      <motion.div custom={8} variants={sectionVariants} initial="hidden" animate="visible">
        <Card className={result.redFlags.length > 0 ? "border-flag/30" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className={`h-5 w-5 ${result.redFlags.length > 0 ? "text-flag" : "text-success"}`} />
              Red Flags &amp; Concerns
              {result.redFlags.length > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">{result.redFlags.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.redFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No red flags identified.</p>
            ) : (
              <div className="space-y-3">
                {result.redFlags.map((flag, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md bg-flag/5 border border-flag/15 p-3">
                    <Badge variant={flag.severity === "high" ? "destructive" : "outline"} className="shrink-0 text-xs mt-0.5">
                      {flag.severity}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{flag.category}</p>
                      <p className="text-sm text-muted-foreground">{flag.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Source Table */}
      <motion.div custom={9} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Table className="h-5 w-5 text-accent" />
              Source-to-Documentation Table
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Finding</th>
                    <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Source</th>
                    <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Date</th>
                    <th className="text-left py-2 font-semibold text-muted-foreground">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sourceTable.map((entry, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4">{entry.finding}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{entry.sourceDocument}</td>
                      <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{entry.date}</td>
                      <td className="py-2"><Badge variant="secondary" className="text-xs">{entry.category}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function Section({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  );
}

function ListSection({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">{label}</p>
      <ul className="list-disc pl-5 space-y-0.5">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
