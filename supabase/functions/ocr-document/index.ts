// OCR fallback for scanned PDFs / images.
// Receives an array of base64-encoded page images (PNG or JPEG) and returns
// the OCR'd text. Uses Lovable AI Gateway (Gemini 2.5 Flash, multimodal).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-check",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const MODEL = "google/gemini-2.5-flash";
const PER_PAGE_TIMEOUT_MS = 60_000;

interface OcrPage {
  // data URL or raw base64; mime defaults to image/png
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
}

interface OcrRequest {
  pages: OcrPage[];
  documentName?: string;
}

async function ocrPage(page: OcrPage, idx: number): Promise<string> {
  const mime = page.mimeType || "image/png";
  const dataUrl = page.dataUrl
    ? page.dataUrl
    : `data:${mime};base64,${page.base64}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an OCR engine for clinical home-health documents (SN notes, vitals, MAR, POC, OASIS, labs, handwriting). Extract ALL text exactly as written. Preserve numbers, units, vitals (BP/HR/SpO2/temp/FSBG), dates, medication names and doses. Output plain text only — no commentary, no markdown.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Transcribe this page (page ${idx + 1}) verbatim:` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OCR HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    return typeof text === "string" ? text : "";
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.headers.get("x-health-check")) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = (await req.json()) as OcrRequest;
    const pages = Array.isArray(body.pages) ? body.pages : [];
    if (!pages.length) {
      return new Response(JSON.stringify({ text: "", pages: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap pages per request to keep within edge-function timeout.
    const MAX_PAGES = 12;
    const truncated = pages.length > MAX_PAGES;
    const work = pages.slice(0, MAX_PAGES);

    const results: string[] = [];
    for (let i = 0; i < work.length; i++) {
      try {
        const txt = await ocrPage(work[i], i);
        results.push(`--- Page ${i + 1} ---\n${txt}`);
      } catch (err) {
        results.push(
          `--- Page ${i + 1} ---\n[OCR_FAILED: ${err instanceof Error ? err.message : String(err)}]`,
        );
      }
    }

    let text = results.join("\n\n");
    if (truncated) {
      text += `\n\n[TRUNCATED: only first ${MAX_PAGES} of ${pages.length} pages were OCR'd]`;
    }

    return new Response(
      JSON.stringify({ text, pages: results, truncated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
