import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import clientPromise from "@/lib/mongodb";
import {
  generateOgFromPng,
  uploadOgImage,
  LogoFetchError,
  getDoneOgBrandNames,
  recordOgResult,
} from "@/lib/brand-processor";

export const maxDuration = 60;

const TOTAL_WORKERS = 5;
const BUDGET_MS = 50_000;

async function logRun(
  worker: number,
  processed: number,
  failed: number,
  remaining: number,
  elapsed_ms: number,
  error?: string,
) {
  await supabase.from("cron_runs").insert({
    trigger: `cron-og-${worker}`,
    processed,
    failed,
    remaining,
    elapsed_ms,
    error: error ?? null,
  });
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
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const [doneNames, allDocs] = await Promise.all([
      getDoneOgBrandNames(),
      col
        .find(
          { step: 4, brand_logo_png_url: { $exists: true, $nin: [null, ""] } },
          { projection: { brandName: 1, brand_logo_png_url: 1, _id: 1 } },
        )
        .toArray(),
    ]);

    const pending = allDocs
      .filter((doc) => !doneNames.has(String(doc.brandName ?? doc._id)))
      .filter((_, i) => i % TOTAL_WORKERS === worker);

    if (pending.length === 0) {
      await logRun(worker, 0, 0, 0, Date.now() - start);
      return NextResponse.json({ done: true, worker, elapsed: Date.now() - start });
    }

    for (const doc of pending) {
      if (Date.now() - start > BUDGET_MS) break;
      const name = String(doc.brandName ?? doc._id);
      const pngUrl = String(doc.brand_logo_png_url);
      try {
        const { ogKey, ogBuf } = await generateOgFromPng(pngUrl);
        const ogUrl = await uploadOgImage(ogKey, ogBuf);
        await Promise.all([
          col.updateOne(
            { _id: doc._id },
            {
              $set: { og_image_jpg_url: ogUrl },
              $unset: { logo_pending: "" },
            },
          ),
          recordOgResult(name, "processed", ogUrl),
        ]);
        processed++;
      } catch (err) {
        if (err instanceof LogoFetchError) {
          await recordOgResult(name, "skipped").catch(() => {});
          continue;
        }
        console.error(`[cron-og-${worker}] failed ${name}:`, err);
        failed++;
      }
    }

    const elapsed_ms = Date.now() - start;
    const remaining = pending.length - processed - failed;
    await logRun(worker, processed, failed, remaining, elapsed_ms);

    return NextResponse.json({ processed, failed, remaining, elapsed_ms, worker });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error(`[cron-og-${worker}]`, err);
    await logRun(worker, processed, failed, 0, Date.now() - start, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
