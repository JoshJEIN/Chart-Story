import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, FileStack, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import ReviewHeader from "@/components/ReviewHeader";
import DocumentUploader from "@/components/DocumentUploader";
import AnalysisDisplay from "@/components/AnalysisDisplay";
import { UploadedDocument, AnalysisResult } from "@/types/pcr";
import { extractTextFromDocuments } from "@/lib/parseDocuments";
import { analyzeDocuments } from "@/lib/analyzeDocuments";

export default function Index() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

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
    setAnalysisResult(null);

    try {
      const extracted = await extractTextFromDocuments(documents);
      const result = await analyzeDocuments(extracted);
      setAnalysisResult(result);
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
          {/* Upload Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FileStack className="h-5 w-5 text-accent" />
              <h2 className="text-base font-semibold">Upload Recertification Packet</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Upload all documents for the current recertification episode — OASIS, Plan of Care,
              F2F, physician orders, SN visit notes, SOAP notes, labs, medication lists, and any
              other supporting records. Categorize each document for best results.
            </p>
            <DocumentUploader documents={documents} onDocumentsChange={setDocuments} />
          </section>

          {/* Analyze Button */}
          <div className="flex justify-center">
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
                  Run PCR Recertification Analysis
                </>
              )}
            </Button>
          </div>

          {/* Results */}
          {analysisResult && (
            <>
              <AnalysisDisplay result={analysisResult} />
              <div className="flex justify-center pt-4">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setDocuments([]);
                    setAnalysisResult(null);
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
