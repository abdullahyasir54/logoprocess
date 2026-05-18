import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { supabase } from "@/lib/supabase";
import { generateImages, uploadImages, brandFileName, LogoFetchError } from "@/lib/brand-processor";

export const maxDuration = 60;

const BATCH = 5;

async function logRun(
  processed: number,
  failed: number,
  remaining: number,
  elapsed_ms: number,
  error?: string,
) {
  await supabase
    .from("cron_runs")
    .insert({ trigger: "cron-brand", processed, failed, remaining, elapsed_ms, error: error ?? null });
}

export async function GET() {
  const start = Date.now();
  let processed = 0;
  let failed = 0;

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const pendingQuery = {
      brandLogo: { $exists: true, $nin: [null, ""] },
      $or: [
        { brand_logo_png_url: { $exists: false } },
        { brand_logo_png_url: { $in: [null, ""] } },
      ],
    };

    const docs = await col.find(pendingQuery).limit(BATCH).toArray();

    if (docs.length === 0) {
      await logRun(0, 0, 0, Date.now() - start);
      return NextResponse.json({ done: true, processed: 0, elapsed: Date.now() - start });
    }

    for (const doc of docs) {
      try {
        const { slug, squareBuf, bannerBuf } = await generateImages(doc as Record<string, unknown>);
        const { squareUrl, bannerUrl } = await uploadImages(slug, squareBuf, bannerBuf);
        await col.updateOne(
          { _id: doc._id },
          { $set: { brand_logo_png_url: squareUrl, og_image_jpg_url: bannerUrl } },
        );
        processed++;
      } catch (err) {
        if (err instanceof LogoFetchError) continue;
        console.error(`brand-cron: failed ${brandFileName(String(doc.brandName ?? doc._id))}:`, err);
        failed++;
      }
    }

    const remaining = await col.countDocuments(pendingQuery);
    const elapsed_ms = Date.now() - start;
    await logRun(processed, failed, remaining, elapsed_ms);

    return NextResponse.json({ done: remaining === 0, processed, failed, remaining, elapsed_ms });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error("[cron-brand]", err);
    await logRun(processed, failed, 0, Date.now() - start, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
