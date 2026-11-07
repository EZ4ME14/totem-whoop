import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonOut } from "../../whoop/json_out.js";

// Not a Whoop call: a once-per-day flag in the Upstash store, so scheduled
// report agents (which keep no state between runs) send each report only once.
// Registered only when the Upstash store is configured.
export function registerReportClaim(server: McpServer): void {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  const redis = async (args: string[]): Promise<unknown> => {
    const res = await fetch(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} failed (${res.status}): ${body.error ?? "no body"}`);
    return body.result;
  };

  server.tool(
    "report_claim",
    "Scheduled-report helper (does not touch Whoop). mode 'check' tells whether today's report of this kind was already sent; mode 'claim' marks it sent and returns claimed:true only for the first caller of the day. Call 'claim' right before sending a report; if claimed is false, do not send.",
    {
      kind: z.enum(["morning", "evening"]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mode: z.enum(["check", "claim"]).default("claim"),
    },
    async ({ kind, date, mode }) => {
      const key = `totem:report:${kind}:${date}`;
      if (mode === "check") {
        const sent = (await redis(["GET", key])) !== null;
        return { content: [{ type: "text", text: jsonOut({ kind, date, already_sent: sent }) }] };
      }
      // SET NX: only the first claim of the day succeeds; key expires after 3 days.
      const ok = (await redis(["SET", key, new Date().toISOString(), "NX", "EX", "259200"])) === "OK";
      return { content: [{ type: "text", text: jsonOut({ kind, date, claimed: ok }) }] };
    },
  );
}
