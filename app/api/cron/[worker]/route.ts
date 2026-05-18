import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys, getAllProcessedKeys, processAndUpload } from "@/lib/logo-processor";

export const maxDuration = 60;

const TOTAL_WORKERS = 5;
const BUDGET_MS = 50_000;

async function logRun(
  trigger: string,
  processed: number,
  failed: number,
  remaining: number,
  elapsed_ms: number,
  error?: string,
) {
  await supabase
    .from("cron_runs")
    .insert({ trigger, processed, failed, remaining, elapsed_ms, error: error ?? null });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ worker: string }> },
) {
  const { worker: workerStr } = await params;
  const worker = parseInt(workerStr, 10);

  if (isNaN(worker) || worker < 0 || worker >= TOTAL_WORKERS) {
    return NextResponse.json({ error: "Invalid worker ID" }, { status: 400 });
  }

  const start = Date.now();
  let processed = 0;
  let failed = 0;

  try {
    const [allKeys, doneSet] = await Promise.all([
      getAllKeys(),
      getAllProcessedKeys(),
    ]);

    const pending = allKeys
      .filter((k) => !doneSet.has(k))
      .filter((_, i) => i % TOTAL_WORKERS === worker);

    if (pending.length === 0) {
      await logRun(`cron-${worker}`, 0, 0, 0, Date.now() - start);
      return NextResponse.json({ done: true, worker, total: allKeys.length });
    }

    for (const key of pending) {
      if (Date.now() - start > BUDGET_MS) break;
      try {
        await processAndUpload(key);
        processed++;
      } catch (err) {
        console.error(`[cron-${worker}] failed ${key}:`, err);
        try {
          await supabase
            .from("processed_logos")
            .upsert({ s3_key: key, status: "failed" }, { onConflict: "s3_key" });
        } catch { /* best effort */ }
        failed++;
      }
    }

    const elapsed_ms = Date.now() - start;
    const remaining = pending.length - processed - failed;
    await logRun(`cron-${worker}`, processed, failed, remaining, elapsed_ms);

    return NextResponse.json({ processed, failed, remaining, elapsed_ms, worker });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error(`[cron-${worker}]`, err);
    await logRun(`cron-${worker}`, processed, failed, 0, Date.now() - start, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
