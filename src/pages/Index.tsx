import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, FileStack, Settings2, Activity, CalendarRange } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import ReviewHeader from "@/components/ReviewHeader";
import DocumentUploader from "@/components/DocumentUploader";
import AnalysisDisplay from "@/components/AnalysisDisplay";
import AdmissionAnalysisDisplay from "@/components/AdmissionAnalysisDisplay";
import SnVisitSeriesDisplay from "@/components/SnVisitSeriesDisplay";
import SnSingleVisitDisplay from "@/components/SnSingleVisitDisplay";
import { UploadedDocument, AnalysisResult } from "@/types/pcr";
import { SocAnalysisResult } from "@/types/soc";
import { SnSeriesResult } from "@/types/snSeries";
import { extractTextFromDocuments } from "@/lib/parseDocuments";
import { analyzeDocuments } from "@/lib/analyzeDocuments";
import { analyzeAdmissionDocuments } from "@/lib/analyzeAdmission";
import { analyzeSnVisitSeries } from "@/lib/analyzeSnSeries";
import { analyzeRecertVisitSeries } from "@/lib/analyzeRecertSeries";
import { analyzeSnVisitDraft } from "@/lib/analyzeSnVisitDraft";
import { parseFrequencyString, buildCertPeriod, extractSnFrequencyFromPOC } from "@/lib/parseFrequency";
import type { RecertSeriesResult } from "@/types/recertSeries";
import type { SnSingleVisitDraft } from "@/types/snVisitDraft";

type AnalysisMode = "recert" | "soc" | "snSeries" | "recertSeries" | "snQuickDraft" | "snRecertDraft";

export default function Index() {
  const [mode, setMode] = useState<AnalysisMode>("recert");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [recertResult, setRecertResult] = useState<AnalysisResult | null>(null);
  const [socResult, setSocResult] = useState<SocAnalysisResult | null>(null);
  const [seriesResult, setSeriesResult] = useState<SnSeriesResult | null>(null);
  const [recertSeriesResult, setRecertSeriesResult] = useState<RecertSeriesResult | null>(null);
  const [draftResult, setDraftResult] = useState<SnSingleVisitDraft | null>(null);
  const [pastedPriorSeriesJson, setPastedPriorSeriesJson] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [maxIterations, setMaxIterations] = useState<number>(3);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // SN Series inputs
  const today = new Date().toISOString().slice(0, 10);
  const [socStartDate, setSocStartDate] = useState<string>(today);
  const [frequencyRaw, setFrequencyRaw] = useState<string>("2w3, 1w6, 1w4");
  const [lupaPeriod1, setLupaPeriod1] = useState<string>("");
  const [lupaPeriod2, setLupaPeriod2] = useState<string>("");
  const [verbalOrderDate, setVerbalOrderDate] = useState<string>("");
  const [verbalOrderMd, setVerbalOrderMd] = useState<string>("");
  const [verbalOrderContent, setVerbalOrderContent] = useState<string>("");

  // Single-visit draft inputs (used by snQuickDraft + snRecertDraft)
  const [draftVisitDate, setDraftVisitDate] = useState<string>(today);
  const [draftVisitNumber, setDraftVisitNumber] = useState<string>("");
  const [draftWeekOfEpisode, setDraftWeekOfEpisode] = useState<string>("");
  const [draftPatientContext, setDraftPatientContext] = useState<string>("");
  const [draftSourceText, setDraftSourceText] = useState<string>("");
  const [draftTeachingFocus, setDraftTeachingFocus] = useState<string>("");
  const [draftPatientId, setDraftPatientId] = useState<string>("");
  const [draftPatientName, setDraftPatientName] = useState<string>("");

  const { toast } = useToast();

  // Derived: POC frequency from the SOC result, if any
  const pocFreq = socResult ? extractSnFrequencyFromPOC(socResult.planOfCare?.disciplineOrders) : null;
  const pocCanonical = pocFreq?.canonical ?? pocFreq?.raw ?? "";
  const userFreq = parseFrequencyString(frequencyRaw);
  const normalizedInput = frequencyRaw.trim().toLowerCase().replace(/\s+/g, " ");
  const freqMatchesPoc =
    !!pocFreq &&
    (pocFreq.raw.trim().toLowerCase() === normalizedInput ||
      pocCanonical.trim().toLowerCase() === normalizedInput);
  const verbalOrderProvided = Boolean(
    verbalOrderDate && verbalOrderMd.trim() && verbalOrderContent.trim(),
  );
  const freqGateOk = !pocFreq || freqMatchesPoc || verbalOrderProvided;

  const switchMode = (next: AnalysisMode) => {
    if (isAnalyzing || next === mode) return;
    setMode(next);
    // Keep socResult when entering snSeries (it consumes it).
    // Keep documents when entering recertSeries (we just uploaded them).
    if (next !== "snSeries" && next !== "recertSeries") setDocuments([]);
    if (next === "snSeries" && documents.length > 0 && !socResult) {
      // documents from a previous mode shouldn't leak into series-only mode
      setDocuments([]);
    }
    if (next === "recert" || next === "recertSeries") setSocResult(null);
    setRecertResult(null);
    if (next !== "snSeries") setSeriesResult(null);
    if (next !== "recertSeries") setRecertSeriesResult(null);
    // When entering SN Series mode, pre-fill frequency from the POC if available.
    if (next === "snSeries" && socResult) {
      const fromPoc = extractSnFrequencyFromPOC(socResult.planOfCare?.disciplineOrders);
      if (fromPoc && fromPoc.parsed.totalVisitsScheduled > 0) {
        // Prefer the canonical form so the input is always parseable, even
        // when the POC stored a natural-language order ("BIW x 8 weeks").
        setFrequencyRaw(fromPoc.canonical || fromPoc.raw);
      }
    }
  };

  const handleHealthCheck = async () => {
    setIsCheckingHealth(true);
    try {
      const fnName =
        mode === "recert" ? "pcr-analyze"
        : mode === "soc" ? "soc-analyze"
        : mode === "snSeries" ? "sn-series-analyze"
        : "recert-series-analyze";
      const { data, error } = await supabase.functions.invoke(fnName, { body: { health: 1 } });
      if (error) throw error;
      const ok = data?.status === "ok";
      toast({
        title: ok ? "Edge function healthy" : "Unexpected health response",
        description: ok
          ? `${fnName} deployed • API key ${data.hasApiKey ? "configured" : "MISSING"} • ${data.timestamp}`
          : JSON.stringify(data),
        variant: ok && data.hasApiKey ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: "Health check failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const runSnSeries = async () => {
    if (!socResult) {
      toast({
        title: "Run Admission/SOC analysis first",
        description: "The SN Visit Series mode consumes the SOC result. Switch to SOC mode, run analysis, then return here.",
        variant: "destructive",
      });
      return;
    }
    const freq = parseFrequencyString(frequencyRaw);
    if (freq.totalVisitsScheduled === 0) {
      toast({
        title: "Frequency string could not be parsed",
        description: 'Use formats like "2w3, 1w6, 1w4" (visits-per-week × weeks).',
        variant: "destructive",
      });
      return;
    }
    if (!freqGateOk) {
      toast({
        title: "Frequency does not match physician orders",
        description: `POC orders "${pocFreq?.raw}" but you entered "${frequencyRaw}". Either use the POC frequency or supply a verbal order (date, MD, content).`,
        variant: "destructive",
      });
      return;
    }
    const certPeriod = buildCertPeriod(socStartDate);
    setIsAnalyzing(true);
    setSeriesResult(null);
    try {
      const result = await analyzeSnVisitSeries(socResult, certPeriod, freq, {
        maxIterations,
        lupaThresholds: {
          period1: lupaPeriod1 ? parseInt(lupaPeriod1, 10) : null,
          period2: lupaPeriod2 ? parseInt(lupaPeriod2, 10) : null,
        },
        expectedFrequencyFromPOC: pocFreq?.raw ?? null,
        verbalOrder: verbalOrderProvided
          ? { date: verbalOrderDate, orderingMd: verbalOrderMd.trim(), content: verbalOrderContent.trim() }
          : null,
      });
      setSeriesResult(result);
      toast({ title: "SN visit series generated", description: `${result.visits?.length ?? 0} visit notes ready for review.` });
    } catch (err: any) {
      toast({
        title: "SN series generation failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const runRecertSeries = async () => {
    if (documents.length === 0) {
      toast({
        title: "Upload the recertification packet first",
        description: "Recert OASIS, updated 485/POC, latest physician orders, current med profile, specialist notes, labs, and recent SN/SOAP notes.",
        variant: "destructive",
      });
      return;
    }
    const freq = parseFrequencyString(frequencyRaw);
    if (freq.totalVisitsScheduled === 0) {
      toast({
        title: "Frequency string could not be parsed",
        description: 'Use formats like "2w8" or "2w3, 1w6, 1w4".',
        variant: "destructive",
      });
      return;
    }

    // Resolve prior series: in-memory first, then pasted JSON.
    let priorSeries: SnSeriesResult | null = seriesResult;
    if (!priorSeries && pastedPriorSeriesJson.trim()) {
      try {
        priorSeries = JSON.parse(pastedPriorSeriesJson) as SnSeriesResult;
      } catch {
        toast({
          title: "Prior series JSON is invalid",
          description: "Paste the JSON exported from a previous SN Visit Series, or leave blank to start fresh.",
          variant: "destructive",
        });
        return;
      }
    }

    const certPeriod = buildCertPeriod(socStartDate);
    setIsAnalyzing(true);
    setRecertSeriesResult(null);

    try {
      const extracted = await extractTextFromDocuments(documents);
      const unreadable = extracted.filter((d) => !d.ok);
      if (unreadable.length === extracted.length) {
        throw new Error(
          `None of the uploaded files produced extractable text. ${
            unreadable[0]?.note ?? "Re-upload as text-based PDF, DOCX, TXT, or CSV."
          }`,
        );
      }
      if (unreadable.length > 0) {
        toast({
          title: `${unreadable.length} file(s) could not be read`,
          description: unreadable.map((d) => `• ${d.name}: ${d.note ?? "no extractable text"}`).join("\n"),
          variant: "destructive",
        });
      }
      const readable = extracted
        .filter((d) => d.ok)
        .map((d) => ({ name: d.name, text: d.text ?? "" }));

      const result = await analyzeRecertVisitSeries(readable, certPeriod, freq, {
        maxIterations,
        lupaThresholds: {
          period1: lupaPeriod1 ? parseInt(lupaPeriod1, 10) : null,
          period2: lupaPeriod2 ? parseInt(lupaPeriod2, 10) : null,
        },
        verbalOrder: verbalOrderProvided
          ? { date: verbalOrderDate, orderingMd: verbalOrderMd.trim(), content: verbalOrderContent.trim() }
          : null,
        priorSeries,
      });
      setRecertSeriesResult(result);
      toast({
        title: "Recert visit series generated",
        description: `${result.visits?.length ?? 0} visit notes • ${result.educationDropped?.length ?? 0} mastered topic(s) dropped • ${result.educationCarriedForward?.length ?? 0} carried forward.`,
      });
    } catch (err: any) {
      toast({
        title: "Recert series generation failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (mode === "snSeries") {
      void runSnSeries();
      return;
    }
    if (mode === "recertSeries") {
      void runRecertSeries();
      return;
    }
    if (documents.length === 0) {
      toast({
        title: "No documents uploaded",
        description: "Please upload at least one document to begin analysis.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setRecertResult(null);
    if (mode === "soc") setSocResult(null);

    try {
      const extracted = await extractTextFromDocuments(documents);
      const unreadable = extracted.filter((d) => !d.ok);
      if (unreadable.length === extracted.length) {
        throw new Error(
          `None of the uploaded files produced extractable text. ${
            unreadable[0]?.note ?? "Re-upload as text-based PDF, DOCX, TXT, or CSV."
          }`,
        );
      }
      if (unreadable.length > 0) {
        toast({
          title: `${unreadable.length} file(s) could not be read`,
          description:
            unreadable.map((d) => `• ${d.name}: ${d.note ?? "no extractable text"}`).join("\n") +
            "\n\nProceeding with the readable files only.",
          variant: "destructive",
        });
      }

      const readable = extracted.filter((d) => d.ok);

      if (mode === "recert") {
        const result = await analyzeDocuments(readable, { maxIterations });
        setRecertResult(result);
      } else {
        const result = await analyzeAdmissionDocuments(readable, { maxIterations });
        setSocResult(result);
      }
      toast({ title: "Analysis complete", description: "Review the results below." });
    } catch (err: any) {
      toast({
        title: "Analysis failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isSoc = mode === "soc";
  const isSeries = mode === "snSeries";
  const isRecertSeries = mode === "recertSeries";
  const isUploadMode = !isSeries; // recertSeries also uploads documents
  const uploaderHelper = isSoc
    ? "Upload the admission packet for the new Start-of-Care episode — physician orders, OASIS SOC, 485 / Plan of Care, Face-to-Face encounter, hospital H&P or discharge summary, doctor / specialist notes, and medication list."
    : isRecertSeries
    ? "Upload the RECERTIFICATION packet for the next 60-day cert period — Recert OASIS, updated 485 / Plan of Care, most recent physician orders, current medication profile, specialist visits, lab work, and recent SN / SOAP notes."
    : "Upload all documents for the current recertification episode — OASIS, Plan of Care, F2F, physician orders, SN visit notes, SOAP notes, labs, medication lists, and any other supporting records.";
  const analyzeButtonLabel = isSeries
    ? `Generate ${parseFrequencyString(frequencyRaw).totalVisitsScheduled || "—"} SN Visit Notes (60-day cert)`
    : isRecertSeries
    ? `Generate ${parseFrequencyString(frequencyRaw).totalVisitsScheduled || "—"} Recert SN Visit Notes (next 60 days)`
    : isSoc
    ? "Run Admission / SOC Care-Plan Analysis"
    : "Run PCR Recertification Analysis";

  return (
    <div className="min-h-screen bg-background">
      <ReviewHeader />

      <main className="container py-8 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-8"
        >
          {/* Mode Toggle */}
          <section className="rounded-md border border-border bg-card p-4">
            <Label className="text-sm font-semibold mb-3 block">Analysis Mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => switchMode(v as AnalysisMode)}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
            >
              <ModeCard
                value="recert"
                checked={mode === "recert"}
                disabled={isAnalyzing}
                title="Recertification (PCR)"
                desc="Compare initial vs. most-recent 60-day episode. Audit-defensible PMHx, chart story, red flags, med changes."
              />
              <ModeCard
                value="soc"
                checked={mode === "soc"}
                disabled={isAnalyzing}
                title="Admission / Start-of-Care"
                desc="Forward-looking 485-aligned care plan, first SN visit note template, and patient/caregiver education plan."
              />
              <ModeCard
                value="recertSeries"
                checked={mode === "recertSeries"}
                disabled={isAnalyzing}
                title="Recert Visit Series (next 60d)"
                desc="Generates the next 60-day SN visit series from a fresh recertification packet, with education continuity (drops mastered topics, carries forward in-progress)."
              />
              <ModeCard
                value="snSeries"
                checked={mode === "snSeries"}
                disabled={isAnalyzing}
                title="SN Visit Series (60-day)"
                desc={
                  socResult
                    ? "Generates the entire 60-day cert-period of SN visit notes from the SOC result, with non-cloned vitals, education advancement, LUPA flagging, and pre-claim audit."
                    : "Run Admission / SOC analysis first — the series generator consumes its output."
                }
              />
            </RadioGroup>
          </section>

          {/* Upload Section — hidden in SN Series (post-SOC) mode */}
          {isUploadMode && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <FileStack className="h-5 w-5 text-accent" />
                <h2 className="text-base font-semibold">
                  {isSoc ? "Upload Admission Packet" : isRecertSeries ? "Upload Recertification Packet" : "Upload Recertification Packet"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">{uploaderHelper}</p>
              <DocumentUploader documents={documents} onDocumentsChange={setDocuments} />
            </section>
          )}

          {/* SN Series inputs */}
          {(isSeries || isRecertSeries) && (
            <section className="rounded-md border border-border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-accent" />
                <h2 className="text-base font-semibold">Series Inputs</h2>
              </div>
              {isSeries && !socResult && (
                <p className="text-sm text-flag">
                  No SOC result loaded. Switch to "Admission / Start-of-Care", run analysis, then return to this mode.
                </p>
              )}
              {isRecertSeries && (
                <div>
                  <Label className="text-xs">Prior episode (optional)</Label>
                  {seriesResult ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      ✓ Using in-memory prior SN series ({seriesResult.visits?.length ?? 0} visits, education log of {seriesResult.educationLog?.length ?? 0} topics).
                    </p>
                  ) : (
                    <>
                      <textarea
                        value={pastedPriorSeriesJson}
                        onChange={(e) => setPastedPriorSeriesJson(e.target.value)}
                        disabled={isAnalyzing}
                        rows={3}
                        placeholder="Optional: paste the JSON of the prior 60-day SN series for education continuity. Leave blank to start fresh."
                        className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs font-mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Without prior context, education topics are seeded fresh from the recert packet.
                      </p>
                    </>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">{isRecertSeries ? "Recert Episode Start Date" : "SOC Start Date"}</Label>
                  <Input
                    type="date"
                    value={socStartDate}
                    onChange={(e) => setSocStartDate(e.target.value)}
                    disabled={isAnalyzing}
                  />
                </div>
                <div>
                  <Label className="text-xs">
                    Physician Frequency Order (e.g. <span className="font-mono">2w3, 1w6, 1w4</span>)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={frequencyRaw}
                      onChange={(e) => setFrequencyRaw(e.target.value)}
                      disabled={isAnalyzing}
                    />
                    {pocFreq && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFrequencyRaw(pocCanonical || pocFreq.raw)}
                        disabled={isAnalyzing || freqMatchesPoc}
                      >
                        Use POC
                      </Button>
                    )}
                  </div>
                  {pocFreq && (
                    <p className={`mt-1 text-xs ${freqMatchesPoc ? "text-muted-foreground" : "text-flag"}`}>
                      485 POC orders <span className="font-mono">{pocFreq.raw}</span>
                      {pocCanonical && pocCanonical !== pocFreq.raw && (
                        <> → <span className="font-mono">{pocCanonical}</span></>
                      )}{" "}
                      ({pocFreq.parsed.totalVisitsScheduled} SN visits).{" "}
                      {freqMatchesPoc
                        ? "✓ Matches physician orders."
                        : "⚠ Differs from physician orders — verbal order required."}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">LUPA Threshold — Period 1 (days 1–30, optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 4"
                    value={lupaPeriod1}
                    onChange={(e) => setLupaPeriod1(e.target.value)}
                    disabled={isAnalyzing}
                  />
                </div>
                <div>
                  <Label className="text-xs">LUPA Threshold — Period 2 (days 31–60, optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 3"
                    value={lupaPeriod2}
                    onChange={(e) => setLupaPeriod2(e.target.value)}
                    disabled={isAnalyzing}
                  />
                </div>
              </div>

              {pocFreq && !freqMatchesPoc && (
                <div className="rounded-md border border-flag/40 bg-flag/5 p-3 space-y-2">
                  <Label className="text-xs font-semibold text-flag">
                    Verbal Order Reference (required when frequency differs from POC)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      type="date"
                      value={verbalOrderDate}
                      onChange={(e) => setVerbalOrderDate(e.target.value)}
                      placeholder="VO date"
                      disabled={isAnalyzing}
                    />
                    <Input
                      value={verbalOrderMd}
                      onChange={(e) => setVerbalOrderMd(e.target.value)}
                      placeholder="Ordering MD"
                      disabled={isAnalyzing}
                    />
                    <Input
                      value={verbalOrderContent}
                      onChange={(e) => setVerbalOrderContent(e.target.value)}
                      placeholder='VO content (e.g. "change SN to 2w3,1w6,1w4")'
                      disabled={isAnalyzing}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The verbal order will be cited verbatim in visit #1 coordination-of-care and in the pre-claim checklist.
                  </p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Cert period: <span className="font-mono">{buildCertPeriod(socStartDate).startDate}</span> →{" "}
                <span className="font-mono">{buildCertPeriod(socStartDate).endDate}</span> · Parsed visits:{" "}
                <span className="font-mono">{userFreq.totalVisitsScheduled}</span>
              </p>
            </section>
          )}

          {/* Audit settings */}
          <section className="rounded-md border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-accent" />
              <Label className="text-sm font-semibold">
                Maximum audit retry iterations: {maxIterations}
              </Label>
            </div>
            <Slider
              value={[maxIterations]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => setMaxIterations(v[0] ?? 3)}
              disabled={isAnalyzing}
            />
            <p className="text-xs text-muted-foreground">
              The audit loop will revise the draft until criteria pass or this limit is reached.
              Higher values increase quality but cost more time and credits.
            </p>
          </section>

          {/* Analyze Button */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={handleAnalyze}
              disabled={
                isAnalyzing ||
                (isUploadMode && documents.length === 0) ||
                (isSeries && !socResult) ||
                (isSeries && !freqGateOk) ||
                (isRecertSeries && parseFrequencyString(frequencyRaw).totalVisitsScheduled === 0)
              }
              className="gap-2 px-8"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {analyzeButtonLabel}
                </>
              )}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleHealthCheck}
              disabled={isCheckingHealth}
              className="gap-2"
            >
              {isCheckingHealth ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
              Check Edge Function Health
            </Button>
          </div>

          {/* Results */}
          {recertResult && (
            <>
              <AnalysisDisplay result={recertResult} />
              <div className="flex justify-center pt-4">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setDocuments([]);
                    setRecertResult(null);
                  }}
                  className="gap-2 px-8"
                >
                  <FileStack className="h-4 w-4" />
                  New Patient Review
                </Button>
              </div>
            </>
          )}
          {socResult && mode !== "snSeries" && (
            <>
              <AdmissionAnalysisDisplay result={socResult} />
              <div className="flex justify-center pt-4">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setDocuments([]);
                    setSocResult(null);
                  }}
                  className="gap-2 px-8"
                >
                  <FileStack className="h-4 w-4" />
                  New Patient Review
                </Button>
              </div>
            </>
          )}
          {seriesResult && (
            <>
              <SnVisitSeriesDisplay result={seriesResult} />
              <div className="flex justify-center pt-4">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setSeriesResult(null)}
                  className="gap-2 px-8"
                >
                  <FileStack className="h-4 w-4" />
                  Clear Series
                </Button>
              </div>
            </>
          )}
          {recertSeriesResult && (
            <>
              {(recertSeriesResult.educationCarriedForward?.length ||
                recertSeriesResult.educationDropped?.length ||
                recertSeriesResult.newDxAddressed?.length) ? (
                <section className="rounded-md border border-border bg-card p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Recert Continuity Summary</h3>
                  {recertSeriesResult.educationDropped?.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Dropped (mastered or N/A)</Label>
                      <ul className="text-xs list-disc ml-5">
                        {recertSeriesResult.educationDropped.map((d) => (
                          <li key={d.topicId}>{d.topic} — {d.reason}{d.masteredAt ? ` (mastered ${d.masteredAt})` : ""}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {recertSeriesResult.educationCarriedForward?.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Carried forward</Label>
                      <ul className="text-xs list-disc ml-5">
                        {recertSeriesResult.educationCarriedForward.map((c) => (
                          <li key={c.topicId}>{c.topic} ({c.level}) — {c.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {recertSeriesResult.newDxAddressed?.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">New diagnoses addressed</Label>
                      <ul className="text-xs list-disc ml-5">
                        {recertSeriesResult.newDxAddressed.map((n, i) => (
                          <li key={i}>{n.dx} (first addressed: {n.firstAddressedVisitId})</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              ) : null}
              <SnVisitSeriesDisplay result={recertSeriesResult} />
              <div className="flex justify-center pt-4">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => { setRecertSeriesResult(null); setDocuments([]); }}
                  className="gap-2 px-8"
                >
                  <FileStack className="h-4 w-4" />
                  Clear Recert Series
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}

function ModeCard({
  value,
  checked,
  disabled,
  title,
  desc,
}: {
  value: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  desc: string;
}) {
  return (
    <label
      htmlFor={`mode-${value}`}
      className={`cursor-pointer rounded-md border p-3 transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <div className="flex items-start gap-3">
        <RadioGroupItem value={value} id={`mode-${value}`} disabled={disabled} className="mt-1" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">{desc}</p>
        </div>
      </div>
    </label>
  );
}
