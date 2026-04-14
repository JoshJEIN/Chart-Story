import { Shield } from "lucide-react";

export default function ReviewHeader() {
  return (
    <header className="border-b bg-card">
      <div className="container flex items-center gap-3 py-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary">
          <Shield className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">PCR Recertification Review</h1>
          <p className="text-xs text-muted-foreground">Medicare Home Health Pre-Claim Review Analysis</p>
        </div>
      </div>
    </header>
  );
}
