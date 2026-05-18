import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys, processAndUpload } from "@/lib/logo-processor";

export const maxDuration = 60;

async function logRun(trigger: string, processed: number, failed: number, remaining: number, elapsed_ms: number, error?: string) {
  await supabase.from("cron_runs").insert({ trigger, processed, failed, remaining, elapsed_ms, error: error ?? null });
}

export async function GET() {
  const start = Date.now();
  const BUDGET_MS = 50_000;
  let processed = 0;
  let failed = 0;

  try {
    const [allKeys, { data: done }] = await Promise.all([
      getAllKeys(),
      supabase.from("processed_logos").select("s3_key"),
    ]);

    const doneSet = new Set((done ?? []).map((r) => r.s3_key));
    const pending = allKeys.filter((k) => !doneSet.has(k));

    if (pending.length === 0) {
      await logRun("manual", 0, 0, 0, Date.now() - start);
      return NextResponse.json({ done: true, total: allKeys.length });
    }

    const WORKERS = 5;
    const slices: string[][] = Array.from({ length: WORKERS }, () => []);
    pending.forEach((key, i) => slices[i % WORKERS].push(key));

    await Promise.all(
      slices.map(async (slice) => {
        for (const key of slice) {
          if (Date.now() - start > BUDGET_MS) break;
          try {
            await processAndUpload(key);
            processed++;
          } catch (err) {
            console.error(`[run] failed ${key}:`, err);
            try {
              await supabase.from("processed_logos").upsert(
                { s3_key: key, status: "failed" },
                { onConflict: "s3_key" }
              );
            } catch { /* best effort */ }
            failed++;
          }
        }
      })
    );

    const elapsed_ms = Date.now() - start;
    const remaining = pending.length - processed - failed;
    await logRun("manual", processed, failed, remaining, elapsed_ms);

    return NextResponse.json({ processed, failed, remaining, elapsed_ms });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error("[run]", err);
    await logRun("manual", processed, failed, 0, Date.now() - start, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
