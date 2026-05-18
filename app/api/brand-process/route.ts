import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateImages, uploadImages, brandFileName, LogoFetchError, recordBrandResult } from "@/lib/brand-processor";

export const maxDuration = 60;

const DEFAULT_BATCH = 10;

const ELIGIBLE_BASE = {
  enriched: true,
  brandLogo: { $exists: true, $nin: [null, ""] },
};

const BOTH_EMPTY = {
  $and: [
    { $or: [{ brand_logo_png_url: { $exists: false } }, { brand_logo_png_url: { $in: [null, ""] } }] },
    { $or: [{ og_image_jpg_url: { $exists: false } }, { og_image_jpg_url: { $in: [null, ""] } }] },
  ],
};

const BOTH_SET = {
  brand_logo_png_url: { $exists: true, $nin: [null, ""] },
  og_image_jpg_url: { $exists: true, $nin: [null, ""] },
};

// GET — stats
export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const [total, processed] = await Promise.all([
      col.countDocuments(ELIGIBLE_BASE),
      col.countDocuments({ ...ELIGIBLE_BASE, ...BOTH_SET }),
    ]);

    return NextResponse.json({ total, processed, pending: total - processed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// POST body options:
//   { preview: true, brandName?: string }
//     → generate images only, return base64 data URLs (no S3 upload, no DB write)
//   { brandName: string }
//     → force-reprocess a specific brand (upload + save)
//   { limit?: number }
//     → process next batch of pending brands
export async function POST(req: Request) {
  const results: { name: string; slug: string; status: "ok" | "error"; error?: string }[] = [];

  let limit = DEFAULT_BATCH;
  let forceBrandName: string | null = null;
  let preview = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.limit === "number" && body.limit > 0) limit = body.limit;
    if (typeof body?.brandName === "string" && body.brandName.trim()) forceBrandName = body.brandName.trim();
    if (body?.preview === true) preview = true;
  } catch { /* use default */ }

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const query = forceBrandName
      ? { brandName: forceBrandName, ...ELIGIBLE_BASE }
      : { ...ELIGIBLE_BASE, ...BOTH_EMPTY };

    if (preview) {
      const doc = await col.findOne(query);
      if (!doc) return NextResponse.json({ error: "No brand found" }, { status: 404 });

      const name = String(doc.brandName ?? doc._id);
      const { slug, squareBuf, bannerBuf } = await generateImages(doc as Record<string, unknown>);
      return NextResponse.json({
        preview: true,
        name,
        slug,
        square: `data:image/png;base64,${squareBuf.toString("base64")}`,
        banner: `data:image/jpeg;base64,${bannerBuf.toString("base64")}`,
      });
    }

    const docs = await col.find(query).limit(forceBrandName ? 1 : limit).toArray();

    if (docs.length === 0) {
      return NextResponse.json({ done: true, processed: 0, results });
    }

    for (const doc of docs) {
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
        results.push({ name, slug: brandFileName(name), status: "ok" });
      } catch (err) {
        if (err instanceof LogoFetchError) {
          await recordBrandResult(name, "skipped").catch(() => {});
          continue;
        }
        results.push({ name, slug: brandFileName(name), status: "error", error: err instanceof Error ? err.message : "Failed" });
      }
    }

    const [total, processed] = await Promise.all([
      col.countDocuments(ELIGIBLE_BASE),
      col.countDocuments({ ...ELIGIBLE_BASE, ...BOTH_SET }),
    ]);

    return NextResponse.json({
      done: total - processed === 0,
      processed: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      total,
      totalProcessed: processed,
      pending: total - processed,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
