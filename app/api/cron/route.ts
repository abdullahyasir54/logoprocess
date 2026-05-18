import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys, processAndUpload } from "@/lib/logo-processor";

export const maxDuration = 60;

export async function GET() {
  const start = Date.now();
  const BUDGET_MS = 50_000; // stop at 50s to leave buffer before the 60s limit
  let processed = 0;
  let failed = 0;

  try {
    // Fetch key list + done set once for the whole batch
    const [allKeys, { data: done }] = await Promise.all([
      getAllKeys(),
      supabase.from("processed_logos").select("s3_key"),
    ]);

    const doneSet = new Set((done ?? []).map((r) => r.s3_key));
    const pending = allKeys.filter((k) => !doneSet.has(k));

    if (pending.length === 0) {
      return NextResponse.json({ done: true, total: allKeys.length });
    }

    const WORKERS = 5;

    // Distribute keys across workers in round-robin — no overlapping keys
    const slices: string[][] = Array.from({ length: WORKERS }, () => []);
    pending.forEach((key, i) => slices[i % WORKERS].push(key));

    // Each worker processes its own slice sequentially
    const results = await Promise.allSettled(
      slices.map(async (slice) => {
        let n = 0;
        for (const key of slice) {
          if (Date.now() - start > BUDGET_MS) break;
          await processAndUpload(key);
          n++;
        }
        return n;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") processed += r.value;
      else { console.error("[cron] worker failed:", r.reason); failed++; }
    }

    return NextResponse.json({
      processed,
      failed,
      remaining: pending.length - processed - failed,
      elapsed: Date.now() - start,
    });
  } catch (err) {
    console.error("[cron]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
