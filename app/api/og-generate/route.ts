import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateOgFromPng, uploadOgImage, pngUrlToOgKey, LogoFetchError, recordOgResult } from "@/lib/brand-processor";

export const maxDuration = 60;

const CDN = (process.env.CDN_BASE_URL ?? "https://cdn.thecouponchaser.com").replace(/\/$/, "");

const HAS_PNG = {
  brand_logo_png_url: { $exists: true, $nin: [null, ""] },
};

const NEEDS_OG = {
  ...HAS_PNG,
  $or: [
    { og_image_jpg_url: { $exists: false } },
    { og_image_jpg_url: { $in: [null, ""] } },
  ],
};

const HAS_BOTH = {
  ...HAS_PNG,
  og_image_jpg_url: { $exists: true, $nin: [null, ""] },
};

// GET — stats
export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");
    const [total, processed] = await Promise.all([
      col.countDocuments(HAS_PNG),
      col.countDocuments(HAS_BOTH),
    ]);
    return NextResponse.json({ total, processed, pending: total - processed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// POST body:
//   { preview: true, brandName?: string } → generate, return base64 (no upload)
//   { brandName: string }                 → upload specific brand
//   {}                                    → upload next pending brand
export async function POST(req: Request) {
  let preview = false;
  let brandName: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.preview === true) preview = true;
    if (typeof body?.brandName === "string" && body.brandName.trim()) brandName = body.brandName.trim();
  } catch { /* use defaults */ }

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const query = brandName
      ? { brandName, ...HAS_PNG }
      : NEEDS_OG;

    const doc = await col.findOne(query);
    if (!doc) return NextResponse.json({ error: "No brand found matching criteria" }, { status: 404 });

    const name = String(doc.brandName ?? doc._id);
    const pngUrl = String(doc.brand_logo_png_url);
    const ogKey = pngUrlToOgKey(pngUrl);
    const ogCdnUrl = `${CDN}/${ogKey}`;

    const { ogBuf } = await generateOgFromPng(pngUrl);

    if (preview) {
      return NextResponse.json({
        preview: true,
        name,
        pngUrl,
        ogKey,
        ogCdnUrl,
        og: `data:image/jpeg;base64,${ogBuf.toString("base64")}`,
      });
    }

    const savedUrl = await uploadOgImage(ogKey, ogBuf);
    await Promise.all([
      col.updateOne(
        { _id: doc._id },
        {
          $set: { og_image_jpg_url: savedUrl },
          $unset: { logo_pending: "" },
        },
      ),
      recordOgResult(name, "processed", savedUrl),
    ]);

    const [total, processed] = await Promise.all([
      col.countDocuments(HAS_PNG),
      col.countDocuments(HAS_BOTH),
    ]);

    return NextResponse.json({
      name,
      pngUrl,
      ogUrl: savedUrl,
      total,
      processed,
      pending: total - processed,
    });
  } catch (err) {
    if (err instanceof LogoFetchError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
