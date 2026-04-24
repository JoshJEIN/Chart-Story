// Automated tests for the pcr-analyze audit retry loop.
//
// We stub the Lovable AI Gateway by spinning up a local HTTP server that
// replays scripted responses (one per audit iteration), then point the
// edge handler at it via AI_GATEWAY_URL. This lets us assert the loop
// behaviour deterministically without touching real models or credits.
//
// Run with: deno test --allow-net --allow-env supabase/functions/pcr-analyze/

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIXTURES, type ScriptedAnalysis } from "./fixtures.ts";

interface StubServer {
  url: string;
  callCount: () => number;
  stop: () => Promise<void>;
}

async function startStubGateway(scripted: ScriptedAnalysis[]): Promise<StubServer> {
  let calls = 0;

  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    (_req) => {
      const idx = Math.min(calls, scripted.length - 1);
      const payload = scripted[idx];
      calls += 1;

      const body = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "pcr_analysis",
                    arguments: JSON.stringify(payload),
                  },
                },
              ],
            },
          },
        ],
      };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "connection": "close" },
      });
    },
  );

  const addr = server.addr as Deno.NetAddr;
  const url = `http://127.0.0.1:${addr.port}/v1/chat/completions`;

  return {
    url,
    callCount: () => calls,
    stop: async () => {
      await server.shutdown();
    },
  };
}

async function runFixture(fixtureName: keyof typeof FIXTURES, maxIterations?: number) {
  const fixture = FIXTURES[fixtureName];
  const stub = await startStubGateway(fixture.scriptedResponses);

  // Set required env vars for the handler.
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  Deno.env.set("AI_GATEWAY_URL", stub.url);
  Deno.env.set("PCR_ANALYZE_TEST_MODE", "1");

  // Import the handler. Module is cached after first load — that's fine because
  // the handler reads env vars at call time.
  const mod = await import("./index.ts");
  const handler: (req: Request) => Promise<Response> = mod.handler;

  const req = new Request("http://localhost/pcr-analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documents: [
        { category: "oasis", name: "OASIS_SOC.txt", text: "stub OASIS text" },
      ],
      maxIterations,
    }),
  });

  const res = await handler(req);
  const json = await res.json();
  await stub.stop();

  return { json, callCount: stub.callCount(), status: res.status };
}

Deno.test("audit loop: passes on first iteration when AI returns compliant draft", async () => {
  const { json, callCount, status } = await runFixture("passFirstTry");

  assertEquals(status, 200);
  assertEquals(callCount, 1, "should call AI gateway exactly once");
  assertEquals(json.auditPass, true);
  assertEquals(json._auditMeta.iterations, 1);
  assertEquals(json._auditMeta.finalAuditPass, true);
  assertEquals(json._auditMeta.remainingFailures.length, 0);
});

Deno.test("audit loop: retries failing drafts and succeeds when a later draft passes", async () => {
  const { json, callCount, status } = await runFixture("passAfterRetries");

  assertEquals(status, 200);
  assertEquals(callCount, 3, "should retry until passing draft on iteration 3");
  assertEquals(json.auditPass, true);
  assertEquals(json._auditMeta.iterations, 3);
  assertEquals(json._auditMeta.finalAuditPass, true);
  assertEquals(json._auditMeta.remainingFailures.length, 0);
});

Deno.test("audit loop: stops at MAX_AUDIT_ITERATIONS when AI never passes", async () => {
  const { json, callCount, status } = await runFixture("alwaysFails");

  assertEquals(status, 200);
  assertEquals(callCount, 3, "should stop at default max of 3 iterations");
  assertEquals(json.auditPass, false);
  assertEquals(json._auditMeta.iterations, 3);
  assertEquals(json._auditMeta.maxIterations, 3);
  assertEquals(json._auditMeta.finalAuditPass, false);
  assertEquals(
    json._auditMeta.remainingFailures.length > 0,
    true,
    "should surface the AI's reported failures",
  );
});

Deno.test("audit loop: respects caller-provided maxIterations override", async () => {
  // alwaysFails has 5 scripted failures; with maxIterations=5 we should hit all 5.
  const { json, callCount } = await runFixture("alwaysFails", 5);

  assertEquals(callCount, 5, "should respect maxIterations override");
  assertEquals(json._auditMeta.iterations, 5);
  assertEquals(json._auditMeta.maxIterations, 5);
  assertEquals(json._auditMeta.finalAuditPass, false);
});

Deno.test("audit loop: clamps maxIterations to safe range", async () => {
  // 999 should clamp to 10; alwaysFails has 5 scripts but server replays
  // the last one, so we expect callCount === 10 (the clamped max).
  const { json } = await runFixture("alwaysFails", 999);
  assertEquals(json._auditMeta.maxIterations, 10);
});
