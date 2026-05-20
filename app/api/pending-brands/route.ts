import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateImages, uploadImages, recordBrandResult, LogoFetchError } from "@/lib/brand-processor";

export const maxDuration = 60;

export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");
    const docs = await col
      .find(
        { logo_pending: true },
        { projection: { brandName: 1, brandLogo: 1, _id: 1 } },
      )
      .sort({ brandName: 1 })
      .toArray();

    return NextResponse.json({
      brands: docs.map((d) => ({
        id: String(d._id),
        name: String(d.brandName ?? d._id),
        logoUrl: d.brandLogo ? String(d.brandLogo) : null,
      })),
      total: docs.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { brandName, logoUrl, preview } = body as {
    brandName?: string;
    logoUrl?: string;
    preview?: boolean;
  };

  if (!brandName) return NextResponse.json({ error: "brandName required" }, { status: 400 });

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");
    const doc = await col.findOne({ brandName, logo_pending: true });
    if (!doc) return NextResponse.json({ error: "Brand not found or already processed" }, { status: 404 });

    const effectiveDoc = { ...doc, ...(logoUrl ? { brandLogo: logoUrl } : {}) } as Record<string, unknown>;
    if (!effectiveDoc.brandLogo) {
      return NextResponse.json({ error: "No logo URL available — provide one below", fetchError: true }, { status: 422 });
    }

    const { slug, squareBuf, bannerBuf } = await generateImages(effectiveDoc);

    if (preview) {
      return NextResponse.json({
        name: String(doc.brandName ?? doc._id),
        slug,
        square: `data:image/png;base64,${squareBuf.toString("base64")}`,
        banner: `data:image/jpeg;base64,${bannerBuf.toString("base64")}`,
      });
    }

    const { squareUrl, bannerUrl } = await uploadImages(slug, squareBuf, bannerBuf);
    const name = String(doc.brandName ?? doc._id);
    await Promise.all([
      col.updateOne(
        { _id: doc._id },
        {
          $set: { brand_logo_png_url: squareUrl, og_image_jpg_url: bannerUrl },
          $unset: { logo_pending: "" },
        },
      ),
      recordBrandResult(name, "processed"),
    ]);

    return NextResponse.json({ ok: true, squareUrl, bannerUrl });
  } catch (err) {
    if (err instanceof LogoFetchError) {
      return NextResponse.json({ error: err.message, fetchError: true }, { status: 422 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
