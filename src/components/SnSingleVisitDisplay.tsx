import { motion } from "framer-motion";
import {
  Stethoscope,
  GraduationCap,
  ClipboardList,
  AlertTriangle,
  Sparkles,
  FileText,
  Download,
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
import type { SnSingleVisitDraft } from "@/types/snVisitDraft";

interface Props {
  draft: SnSingleVisitDraft;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDocHtml(draft: SnSingleVisitDraft): string {
  const v = draft.visit;
  const showVitals = draft.mode === "quick";
  const o = v.objective as any;
  const vitalsRows: Array<[string, any]> = !showVitals
    ? []
    : ([
        ["Time", o?.timestamp],
        ["BP", o?.bp],
        ["HR", o?.hr],
        ["RR", o?.rr],
        ["SpO2", o?.spo2 != null ? `${o.spo2}%` : undefined],
        ["Temp", o?.temp],
        ["Weight", o?.weight],
        ["FSBG", o?.fsbg],
        ["Pain", o?.painScore],
        ["Edema", o?.edema],
        ["Lung sounds", o?.lungSounds],
        ["Ambulation", o?.ambulationDistanceFt ? `${o.ambulationDistanceFt} ft` : undefined],
        ["Transfer", o?.transferAssist],
      ].filter(([, val]) => val !== undefined && val !== null && val !== "") as Array<[string, any]>);

  const section = (title: string, body?: string) =>
    body
      ? `<h2 style="font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;">${escapeHtml(title)}</h2><p style="white-space:pre-wrap;">${escapeHtml(body)}</p>`
      : "";

  const list = (title: string, items?: string[]) =>
    items?.length
      ? `<h2 style="font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;">${escapeHtml(title)}</h2><ol>${items
          .map((i) => `<li style="margin-bottom:6pt;">${escapeHtml(i)}</li>`)
          .join("")}</ol>`
      : "";

  const eduHtml = v.educationDelivered?.length
    ? `<h2 style="font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;">Education Delivered</h2>` +
      v.educationDelivered
        .map(
          (e: any) =>
            `<p><strong>${escapeHtml(e.topic ?? e.topicId)}</strong> — ${escapeHtml(e.comprehensionPct)}% ${e.masteryReached ? "(mastered)" : ""}</p><p style="white-space:pre-wrap;margin:0 0 8pt;">${escapeHtml(e.response)}</p>`,
        )
        .join("")
    : "";

  const vitalsHtml = vitalsRows.length
    ? `<h2 style="font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;">Objective</h2><table style="border-collapse:collapse;"><tbody>${vitalsRows
        .map(
          ([k, val]) =>
            `<tr><td style="padding:2pt 12pt 2pt 0;color:#555;">${escapeHtml(k)}</td><td style="padding:2pt 0;">${escapeHtml(val)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";

  const goalsHtml = v.goalsProgress?.length
    ? `<h2 style="font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;">Goals Progress</h2><ul>${v.goalsProgress
        .map(
          (g: any) =>
            `<li><strong>${escapeHtml(g.goalRef)}</strong> — ${escapeHtml(g.status)}<br/><span style="color:#555;">${escapeHtml(g.evidence)}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const fullName = draft.patientFullName || "(name not documented)";
  const titleLabel =
    draft.mode === "quick" ? "Quick SN Visit Note" : "Recert Narrative SN Visit Note";

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>CStoryApp — ${escapeHtml(titleLabel)} — ${escapeHtml(fullName)} — ${escapeHtml(v.visitDate)}</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;">
<h1 style="font-size:18pt;margin-bottom:0;">CStoryApp — ${escapeHtml(titleLabel)}</h1>
<h2 style="font-size:14pt;margin:2pt 0 0;">${escapeHtml(fullName)}</h2>
<p style="margin-top:2pt;color:#555;">${escapeHtml(v.visitDate)} &middot; ${escapeHtml(v.visitType)}${draft.patientIdentifier ? ` &middot; ID: ${escapeHtml(draft.patientIdentifier)}` : ""}</p>
${section("Subjective", v.subjective)}
${vitalsHtml}
${section("Assessment", v.assessment)}
${list("Planned Interventions", v.plannedInterventions)}
${eduHtml}
${v.coordinationOfCare ? section("Coordination of Care", v.coordinationOfCare) : ""}
${goalsHtml}
${section("Next Visit Focus", v.nextVisitFocus)}
${section("Homebound (visit-specific)", v.homeboundRestated)}
</body></html>`;
}

function sanitizeFn(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Unknown";
}

function downloadDraft(draft: SnSingleVisitDraft) {
  const html = buildDocHtml(draft);
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const modeTag = draft.mode === "quick" ? "Quick_SN_Visit" : "Recert_SN_Visit";
  const name = sanitizeFn(draft.patientFullName || draft.patientIdentifier || "Unknown_Pt");
  const date = draft.visit.visitDate || "draft";
  a.download = `CStoryApp_${modeTag}_${name}_${date}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
                CStoryApp —{" "}
                {draft.mode === "quick"
                  ? "Quick SN Visit Draft"
                  : "Recert Narrative SN Visit Draft"}
                {draft.patientFullName ? ` — ${draft.patientFullName}` : ""}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{v.visitDate}</Badge>
                <Badge variant="secondary">{v.visitType}</Badge>
                <Button size="sm" variant="outline" onClick={() => downloadDraft(draft)}>
                  <Download className="h-4 w-4" /> Download
                </Button>
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
      <ol className="mt-1 list-decimal ml-5 text-sm space-y-2">
        {items.map((it, i) => (
          <li key={i} className="leading-relaxed">{it}</li>
        ))}
      </ol>
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
