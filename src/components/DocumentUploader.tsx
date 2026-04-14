import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  UploadedDocument,
  DocumentCategory,
  CATEGORY_LABELS,
} from "@/types/pcr";

interface DocumentUploaderProps {
  documents: UploadedDocument[];
  onDocumentsChange: (docs: UploadedDocument[]) => void;
}

export default function DocumentUploader({
  documents,
  onDocumentsChange,
}: DocumentUploaderProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = useCallback(
    (files: FileList) => {
      const newDocs: UploadedDocument[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        category: guessCategory(file.name),
        file,
        uploadedAt: new Date(),
      }));
      onDocumentsChange([...documents, ...newDocs]);
    },
    [documents, onDocumentsChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removeDoc = (id: string) => {
    onDocumentsChange(documents.filter((d) => d.id !== id));
  };

  const updateCategory = (id: string, category: DocumentCategory) => {
    onDocumentsChange(
      documents.map((d) => (d.id === id ? { ...d, category } : d))
    );
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragActive
            ? "border-accent bg-accent/5"
            : "border-border hover:border-accent/50"
        }`}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.csv,.xlsx"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">
          Drop files here or click to upload
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOC, DOCX, TXT, CSV, XLSX — up to 20MB each
        </p>
      </div>

      <AnimatePresence>
        {documents.map((doc) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <Card className="flex items-center gap-3 p-3">
              <FileText className="h-5 w-5 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(doc.file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <div className="relative">
                <select
                  value={doc.category}
                  onChange={(e) =>
                    updateCategory(doc.id, e.target.value as DocumentCategory)
                  }
                  className="appearance-none bg-secondary text-secondary-foreground text-xs rounded-md px-3 py-1.5 pr-7 border-none focus:ring-1 focus:ring-accent cursor-pointer"
                >
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeDoc(doc.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function guessCategory(name: string): DocumentCategory {
  const lower = name.toLowerCase();
  if (lower.includes("oasis")) return "oasis";
  if (lower.includes("poc") || lower.includes("plan")) return "plan_of_care";
  if (lower.includes("f2f") || lower.includes("face")) return "face_to_face";
  if (lower.includes("order") || lower.includes("cert")) return "physician_order";
  if (lower.includes("visit") || lower.includes("sn ")) return "sn_visit_notes";
  if (lower.includes("soap") || lower.includes("specialist")) return "soap_notes";
  if (lower.includes("lab") || lower.includes("imaging")) return "labs_diagnostics";
  if (lower.includes("med") || lower.includes("mar")) return "medication_list";
  return "other";
}
