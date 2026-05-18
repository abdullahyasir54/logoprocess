import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import clientPromise from "@/lib/mongodb";

export const maxDuration = 60;

const DEFAULT_BATCH = 10;
const BANNER_W = 1200;
const BANNER_H = 630;
const PADDING = 10;
const CDN = (process.env.CDN_BASE_URL ?? "https://cdn.thecouponchaser.com").replace(/\/$/, "");
const BUCKET = process.env.AWS_BUCKET!;
const REGION = process.env.AWS_REGION ?? "us-east-1";

function makeS3() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

function brandFileName(name: string) {
  return name.trim().replace(/\s+/g, "-");
}

class LogoFetchError extends Error {}

async function detectBg(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const pts: [number, number][] = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
    [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)],
  ];

  let r = 0, g = 0, b = 0, a = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * channels;
    r += data[i];
    g += data[i + 1] ?? data[i];
    b += data[i + 2] ?? data[i];
    a += channels >= 4 ? data[i + 3] : 255;
  }
  const n = pts.length;
  if (channels >= 4 && a / n < 128) return { r: 255, g: 255, b: 255 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

async function generateImages(doc: Record<string, unknown>): Promise<{
  slug: string;
  squareBuf: Buffer;
  bannerBuf: Buffer;
}> {
  const brandName = String(doc.brandName ?? "brand");
  const logoUrl = String(doc.brandLogo);
  const slug = brandFileName(brandName);

  let fetchRes: Response;
  try {
    fetchRes = await fetch(logoUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; brand-processor/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new LogoFetchError(`Network error: ${err instanceof Error ? err.message : "unknown"}`);
  }
  if (!fetchRes.ok) throw new LogoFetchError(`Fetch failed: ${fetchRes.status}`);
  const inputBuf = Buffer.from(await fetchRes.arrayBuffer());

  const meta = await sharp(inputBuf).metadata();
  const hasAlpha = (meta.channels ?? 3) >= 4;
  const outCh: 3 | 4 = hasAlpha ? 4 : 3;

  const bg = await detectBg(inputBuf);
  const bgFill = outCh === 4 ? { ...bg, alpha: 1 as const } : bg;

  let trimmed: Buffer;
  try { trimmed = await sharp(inputBuf).trim({ threshold: 10 }).toBuffer(); }
  catch { trimmed = inputBuf; }

  const tm = await sharp(trimmed).metadata();
  const tw = tm.width ?? 1;
  const th = tm.height ?? 1;

  const padded = await sharp(trimmed)
    .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: bgFill })
    .toBuffer();
  const pw = tw + PADDING * 2;
  const ph = th + PADDING * 2;
  const sq = Math.max(pw, ph);

  const squareBuf = await sharp({
    create: { width: sq, height: sq, channels: outCh, background: bgFill },
  })
    .composite([{ input: padded, left: Math.floor((sq - pw) / 2), top: Math.floor((sq - ph) / 2) }])
    .png()
    .toBuffer();

  const maxLogoH = Math.round(BANNER_H * 0.65);
  const logoSize = Math.min(maxLogoH, Math.max(sq, Math.min(maxLogoH, sq * 2)));
  const scaledLogo = sq !== logoSize
    ? await sharp(squareBuf).resize(logoSize, logoSize, { fit: "fill", kernel: "lanczos3" }).toBuffer()
    : squareBuf;

  const bannerBuf = await sharp({
    create: { width: BANNER_W, height: BANNER_H, channels: outCh, background: bgFill },
  })
    .composite([{
      input: scaledLogo,
      left: Math.floor((BANNER_W - logoSize) / 2),
      top: Math.floor((BANNER_H - logoSize) / 2),
    }])
    .flatten({ background: bg })
    .jpeg({ quality: 90 })
    .toBuffer();

  return { slug, squareBuf, bannerBuf };
}

async function uploadImages(slug: string, squareBuf: Buffer, bannerBuf: Buffer): Promise<{
  squareUrl: string;
  bannerUrl: string;
}> {
  const s3 = makeS3();
  const squareKey = `brand-logos/${slug}-logo.png`;
  const bannerKey = `brand-logos/${slug}-logo-og.jpg`;

  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: squareKey, Body: squareBuf,
      ContentType: "image/png", CacheControl: "max-age=0",
    })),
    s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: bannerKey, Body: bannerBuf,
      ContentType: "image/jpeg", CacheControl: "max-age=0",
    })),
  ]);

  return {
    squareUrl: `${CDN}/${squareKey}`,
    bannerUrl: `${CDN}/${bannerKey}`,
  };
}

// GET — stats
export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db("RawDB").collection("brand_migration");

    const [total, processed] = await Promise.all([
      col.countDocuments({ brandLogo: { $exists: true, $nin: [null, ""] } }),
      col.countDocuments({ brand_logo_png_url: { $exists: true, $nin: [null, ""] } }),
    ]);

    return NextResponse.json({ total, processed, pending: total - processed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// POST body options:
//   { preview: true, brandName?: string, limit?: number }
//     → generate images only, return base64 data URLs (no S3 upload, no DB write)
//   { brandName: string }
//     → force-reprocess a specific brand (upload + save)
//   { limit?: number }
//     → process next batch of pending brands
export async function POST(req: Request) {
  const results: { name: string; fileName: string; status: "ok" | "error"; error?: string }[] = [];

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
      ? { brandName: forceBrandName, brandLogo: { $exists: true, $nin: [null, ""] } }
      : {
          brandLogo: { $exists: true, $nin: [null, ""] },
          $or: [
            { brand_logo_png_url: { $exists: false } },
            { brand_logo_png_url: { $in: [null, ""] } },
          ],
        };

    // Preview mode: generate images for the first matching brand, return base64
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
        await col.updateOne(
          { _id: doc._id },
          { $set: { brand_logo_png_url: squareUrl, og_image_jpg_url: bannerUrl } },
        );
        results.push({ name, slug: brandFileName(name), status: "ok" });
      } catch (err) {
        if (err instanceof LogoFetchError) continue;
        results.push({ name, slug: brandFileName(name), status: "error", error: err instanceof Error ? err.message : "Failed" });
      }
    }

    const [total, processed] = await Promise.all([
      col.countDocuments({ brandLogo: { $exists: true, $nin: [null, ""] } }),
      col.countDocuments({ brand_logo_png_url: { $exists: true, $nin: [null, ""] } }),
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
