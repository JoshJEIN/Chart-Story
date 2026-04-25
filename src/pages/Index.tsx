import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, FileStack, Settings2, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import ReviewHeader from "@/components/ReviewHeader";
import DocumentUploader from "@/components/DocumentUploader";
import AnalysisDisplay from "@/components/AnalysisDisplay";
import AdmissionAnalysisDisplay from "@/components/AdmissionAnalysisDisplay";
import { UploadedDocument, AnalysisResult } from "@/types/pcr";
import { SocAnalysisResult } from "@/types/soc";
import { extractTextFromDocuments } from "@/lib/parseDocuments";
import { analyzeDocuments } from "@/lib/analyzeDocuments";
import { analyzeAdmissionDocuments } from "@/lib/analyzeAdmission";

type AnalysisMode = "recert" | "soc";

export default function Index() {
  const [mode, setMode] = useState<AnalysisMode>("recert");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [recertResult, setRecertResult] = useState<AnalysisResult | null>(null);
  const [socResult, setSocResult] = useState<SocAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [maxIterations, setMaxIterations] = useState<number>(3);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const { toast } = useToast();

  const switchMode = (next: AnalysisMode) => {
    if (isAnalyzing || next === mode) return;
    setMode(next);
    setDocuments([]);
    setRecertResult(null);
    setSocResult(null);
  };

  const handleHealthCheck = async () => {
    setIsCheckingHealth(true);
    try {
      const fnName = mode === "recert" ? "pcr-analyze" : "soc-analyze";
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: { health: 1 },
      });
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

  const handleAnalyze = async () => {
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
    setSocResult(null);

    try {
      const extracted = await extractTextFromDocuments(documents);

      const unreadable = extracted.filter((d) => !d.ok);
      if (unreadable.length === extracted.length) {
        throw new Error(
          `None of the uploaded files produced extractable text. ${
            unreadable[0]?.note ?? "Re-upload as text-based PDF, DOCX, TXT, or CSV."
          }`
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
  const uploaderHelper = isSoc
    ? "Upload the admission packet for the new Start-of-Care episode — physician orders, OASIS SOC, 485 / Plan of Care, Face-to-Face encounter, hospital H&P or discharge summary, doctor / specialist notes, and medication list. Categorize each document for best results."
    : "Upload all documents for the current recertification episode — OASIS, Plan of Care, F2F, physician orders, SN visit notes, SOAP notes, labs, medication lists, and any other supporting records. Categorize each document for best results.";
  const analyzeButtonLabel = isSoc
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
              className="flex flex-col sm:flex-row gap-3"
            >
              <label
                htmlFor="mode-recert"
                className={`flex-1 cursor-pointer rounded-md border p-3 transition-colors ${
                  mode === "recert" ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
                } ${isAnalyzing ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="recert" id="mode-recert" disabled={isAnalyzing} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium">Recertification (PCR)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Compare initial vs. most-recent 60-day episode. Audit-defensible PMHx, chart story, red flags, med changes.
                    </p>
                  </div>
                </div>
              </label>
              <label
                htmlFor="mode-soc"
                className={`flex-1 cursor-pointer rounded-md border p-3 transition-colors ${
                  mode === "soc" ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
                } ${isAnalyzing ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="soc" id="mode-soc" disabled={isAnalyzing} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium">Admission / Start-of-Care</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Forward-looking 485-aligned care plan, first SN visit note template, and patient/caregiver education plan.
                    </p>
                  </div>
                </div>
              </label>
            </RadioGroup>
          </section>

          {/* Upload Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FileStack className="h-5 w-5 text-accent" />
              <h2 className="text-base font-semibold">
                {isSoc ? "Upload Admission Packet" : "Upload Recertification Packet"}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{uploaderHelper}</p>
            <DocumentUploader documents={documents} onDocumentsChange={setDocuments} />
          </section>

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
              The audit loop will revise the draft until STEP 6 passes or this limit is reached.
              Higher values increase quality but cost more time and credits.
            </p>
          </section>

          {/* Analyze Button */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={handleAnalyze}
              disabled={isAnalyzing || documents.length === 0}
              className="gap-2 px-8"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing Documents…
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
          {socResult && (
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
        </motion.div>
      </main>
    </div>
  );
}
