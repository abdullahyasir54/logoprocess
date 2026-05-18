import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateImages, uploadImages, brandFileName, LogoFetchError } from "@/lib/brand-processor";

export const maxDuration = 60;

const BATCH = 5;

export async function GET() {
  const started = Date.now();

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const docs = await col.find({
      brandLogo: { $exists: true, $nin: [null, ""] },
      $or: [
        { brand_logo_png_url: { $exists: false } },
        { brand_logo_png_url: { $in: [null, ""] } },
      ],
    }).limit(BATCH).toArray();

    if (docs.length === 0) {
      return NextResponse.json({ done: true, processed: 0, elapsed: Date.now() - started });
    }

    let processed = 0;
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
      }
    }

    const pending = await col.countDocuments({
      brandLogo: { $exists: true, $nin: [null, ""] },
      $or: [
        { brand_logo_png_url: { $exists: false } },
        { brand_logo_png_url: { $in: [null, ""] } },
      ],
    });

    return NextResponse.json({ done: pending === 0, processed, pending, elapsed: Date.now() - started });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
