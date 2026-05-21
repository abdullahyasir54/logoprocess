import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { supabase } from "@/lib/supabase";
import { generateImages, uploadImages, recordBrandResult, LogoFetchError } from "@/lib/brand-processor";

export const maxDuration = 60;

export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");
    const docs = await col
      .find(
        { logo_pending: true },
        { projection: { brandName: 1, brandLogo: 1, brandWebsite: 1, inaccessible: 1, _id: 1 } },
      )
      .sort({ brandName: 1 })
      .toArray();

    const names = docs.map((d) => String(d.brandName ?? d._id));
    let statusMap = new Map<string, string>();
    if (names.length > 0) {
      const { data } = await supabase
        .from("brand_logos")
        .select("brand_name, status")
        .in("brand_name", names);
      if (data) statusMap = new Map(data.map((r) => [r.brand_name as string, r.status as string]));
    }

    return NextResponse.json({
      brands: docs.map((d) => ({
        id: String(d._id),
        name: String(d.brandName ?? d._id),
        logoUrl: d.brandLogo ? String(d.brandLogo) : null,
        website: d.brandWebsite ? String(d.brandWebsite) : null,
        inaccessible: !!d.inaccessible,
        status: statusMap.get(String(d.brandName ?? d._id)) ?? "pending",
      })),
      total: docs.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { brandName, logoUrl, logoData, preview, skip, moveToPending, markInaccessible } = body as {
    brandName?: string;
    logoUrl?: string;
    logoData?: string;
    preview?: boolean;
    skip?: boolean;
    moveToPending?: boolean;
    markInaccessible?: boolean;
  };

  if (!brandName) return NextResponse.json({ error: "brandName required" }, { status: 400 });

  if (skip) {
    await supabase
      .from("brand_logos")
      .upsert({ brand_name: brandName, status: "skipped" }, { onConflict: "brand_name" });
    return NextResponse.json({ ok: true });
  }

  if (moveToPending) {
    await supabase.from("brand_logos").delete().eq("brand_name", brandName);
    const client = await clientPromise;
    await client.db("RawDB").collection("brand_migration")
      .updateOne({ brandName }, { $unset: { inaccessible: "" } });
    return NextResponse.json({ ok: true });
  }

  if (markInaccessible) {
    const client = await clientPromise;
    await client.db("RawDB").collection("brand_migration")
      .updateOne({ brandName }, { $set: { inaccessible: true } });
    return NextResponse.json({ ok: true });
  }

  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");
    const doc = await col.findOne({ brandName, logo_pending: true });
    if (!doc) return NextResponse.json({ error: "Brand not found or already processed" }, { status: 404 });

    let logoBuffer: Buffer | undefined;
    const effectiveDoc = { ...doc } as Record<string, unknown>;

    if (logoData) {
      const base64 = logoData.includes(",") ? logoData.split(",")[1] : logoData;
      logoBuffer = Buffer.from(base64, "base64");
    } else if (logoUrl) {
      effectiveDoc.brandLogo = logoUrl;
    }

    if (!logoBuffer && !effectiveDoc.brandLogo) {
      return NextResponse.json({ error: "No logo available — upload an image", fetchError: true }, { status: 422 });
    }

    const { slug, squareBuf, bannerBuf } = await generateImages(effectiveDoc, logoBuffer);

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
          $unset: { logo_pending: "", inaccessible: "" },
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
