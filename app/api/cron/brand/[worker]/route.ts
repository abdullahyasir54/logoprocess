import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import clientPromise from "@/lib/mongodb";
import {
  generateImages,
  uploadImages,
  brandFileName,
  LogoFetchError,
  getDoneBrandNames,
  recordBrandResult,
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
    trigger: `cron-brand-${worker}`,
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
      getDoneBrandNames(),
      col
        .find(
          { enriched: true, brandLogo: { $exists: true, $nin: [null, ""] } },
          { projection: { brandName: 1, brandLogo: 1, _id: 1 } },
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
      try {
        const { slug, squareBuf, bannerBuf } = await generateImages(doc as Record<string, unknown>);
        const { squareUrl, bannerUrl } = await uploadImages(slug, squareBuf, bannerBuf);
        await Promise.all([
          col.updateOne(
            { _id: doc._id },
            { $set: { brand_logo_png_url: squareUrl, og_image_jpg_url: bannerUrl } },
          ),
          recordBrandResult(name, "processed"),
        ]);
        processed++;
      } catch (err) {
        if (err instanceof LogoFetchError) {
          await recordBrandResult(name, "skipped").catch(() => {});
          continue;
        }
        console.error(`[cron-brand-${worker}] failed ${brandFileName(name)}:`, err);
        failed++;
      }
    }

    const elapsed_ms = Date.now() - start;
    const remaining = pending.length - processed - failed;
    await logRun(worker, processed, failed, remaining, elapsed_ms);

    return NextResponse.json({ processed, failed, remaining, elapsed_ms, worker });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error(`[cron-brand-${worker}]`, err);
    await logRun(worker, processed, failed, 0, Date.now() - start, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
