import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, FileSearch, Table } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnalysisResult } from "@/types/pcr";

interface AnalysisDisplayProps {
  result: AnalysisResult;
}

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.4 },
  }),
};

export default function AnalysisDisplay({ result }: AnalysisDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Recertification Analysis */}
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="h-5 w-5 text-success" />
              Recertification Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-body text-sm leading-relaxed">
              {result.recertificationAnalysis}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Chart Story Summary */}
      <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-5 w-5 text-accent" />
              Chart Story Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-body text-sm leading-relaxed">
              {result.chartStorySummary}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Red Flags */}
      <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
        <Card className={result.redFlags.length > 0 ? "border-flag/30" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle
                className={`h-5 w-5 ${result.redFlags.length > 0 ? "text-flag" : "text-success"}`}
              />
              Red Flags &amp; Concerns
              {result.redFlags.length > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">
                  {result.redFlags.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.redFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No red flags identified.</p>
            ) : (
              <div className="space-y-3">
                {result.redFlags.map((flag, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-md bg-flag/5 border border-flag/15 p-3"
                  >
                    <Badge
                      variant={flag.severity === "high" ? "destructive" : "outline"}
                      className="shrink-0 text-xs mt-0.5"
                    >
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

      {/* Source-to-Documentation Table */}
      <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
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
                      <td className="py-2">
                        <Badge variant="secondary" className="text-xs">{entry.category}</Badge>
                      </td>
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
