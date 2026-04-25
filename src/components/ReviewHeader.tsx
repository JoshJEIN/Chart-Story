import { Shield } from "lucide-react";

export default function ReviewHeader() {
  return (
    <header className="border-b bg-card">
      <div className="container flex items-center gap-3 py-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary">
          <Shield className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Chart Story</h1>
          <p className="text-xs text-muted-foreground">
            Audit-ready home health documentation — Recertification, SOC admission, and 60-day SN visit series
          </p>
        </div>
      </div>
    </header>
  );
}
