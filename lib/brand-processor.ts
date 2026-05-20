import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { supabase } from "./supabase";

export const BANNER_W = 1200;
export const BANNER_H = 630;
const PADDING = 10;
const CDN = (process.env.CDN_BASE_URL ?? "https://cdn.thecouponchaser.com").replace(/\/$/, "");
const BUCKET = process.env.AWS_BUCKET!;
const REGION = process.env.AWS_REGION ?? "us-east-1";

export class LogoFetchError extends Error {}

export function brandFileName(name: string) {
  return name.trim().replace(/\s+/g, "-");
}

function makeS3() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

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

export async function generateImages(
  doc: Record<string, unknown>,
  logoBuffer?: Buffer,
): Promise<{
  slug: string;
  squareBuf: Buffer;
  bannerBuf: Buffer;
}> {
  const brandName = String(doc.brandName ?? "brand");
  const slug = brandFileName(brandName);

  let inputBuf: Buffer;
  if (logoBuffer) {
    inputBuf = logoBuffer;
  } else {
    const logoUrl = String(doc.brandLogo);
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
    inputBuf = Buffer.from(await fetchRes.arrayBuffer());
  }

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

export async function uploadImages(slug: string, squareBuf: Buffer, bannerBuf: Buffer): Promise<{
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

export async function getDoneBrandNames(): Promise<Set<string>> {
  const PAGE = 1000;
  const names = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("brand_logos")
      .select("brand_name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) names.add(row.brand_name as string);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return names;
}

export async function recordBrandResult(brandName: string, status: "processed" | "skipped") {
  await supabase
    .from("brand_logos")
    .upsert({ brand_name: brandName, status }, { onConflict: "brand_name" });
}

export async function getDoneOgBrandNames(): Promise<Set<string>> {
  const PAGE = 1000;
  const names = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("og_images")
      .select("brand_name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) names.add(row.brand_name as string);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return names;
}

export async function recordOgResult(brandName: string, status: "processed" | "skipped", ogUrl?: string) {
  await supabase
    .from("og_images")
    .upsert(
      { brand_name: brandName, status, og_url: ogUrl ?? null },
      { onConflict: "brand_name" },
    );
}

export function pngUrlToOgKey(pngUrl: string): string {
  const urlPath = new URL(pngUrl).pathname; // /brand-logos/1-Up-Nutrition-logo.png
  const key = urlPath.slice(1);             // brand-logos/1-Up-Nutrition-logo.png
  return key.replace(/\.png$/i, "-og.jpg"); // brand-logos/1-Up-Nutrition-logo-og.jpg
}

export async function generateOgFromPng(pngUrl: string): Promise<{
  ogKey: string;
  ogBuf: Buffer;
}> {
  let fetchRes: Response;
  try {
    fetchRes = await fetch(pngUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; brand-processor/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new LogoFetchError(`Network error: ${err instanceof Error ? err.message : "unknown"}`);
  }
  if (!fetchRes.ok) throw new LogoFetchError(`Fetch failed: ${fetchRes.status}`);
  const inputBuf = Buffer.from(await fetchRes.arrayBuffer());

  const bg = await detectBg(inputBuf);
  const meta = await sharp(inputBuf).metadata();
  const srcSize = Math.max(meta.width ?? 1, meta.height ?? 1);

  const maxLogoH = Math.round(BANNER_H * 0.65);
  const logoSize = Math.min(maxLogoH, Math.max(srcSize, Math.min(maxLogoH, srcSize * 2)));

  const scaledLogo = srcSize !== logoSize
    ? await sharp(inputBuf).resize(logoSize, logoSize, { fit: "fill", kernel: "lanczos3" }).toBuffer()
    : inputBuf;

  const ogBuf = await sharp({
    create: { width: BANNER_W, height: BANNER_H, channels: 3, background: bg },
  })
    .composite([{
      input: scaledLogo,
      left: Math.floor((BANNER_W - logoSize) / 2),
      top: Math.floor((BANNER_H - logoSize) / 2),
    }])
    .flatten({ background: bg })
    .jpeg({ quality: 90 })
    .toBuffer();

  return { ogKey: pngUrlToOgKey(pngUrl), ogBuf };
}

export async function uploadOgImage(ogKey: string, ogBuf: Buffer): Promise<string> {
  const s3 = makeS3();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: ogKey,
    Body: ogBuf,
    ContentType: "image/jpeg",
    CacheControl: "max-age=0",
  }));
  return `${CDN}/${ogKey}`;
}
