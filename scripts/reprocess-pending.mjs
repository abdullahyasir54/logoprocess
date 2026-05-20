#!/usr/bin/env node
// Reprocesses all logo_pending: true brands that are missing both URLs.
// Steps: fetch from MongoDB → queue in Supabase brand_logos as "pending"
//        → generate PNG + OG → upload to S3 → update MongoDB + Supabase.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const lines = readFileSync(envPath, "utf8").split("\n");
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (k && !(k in process.env)) process.env[k] = v;
}

import { MongoClient } from "mongodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const PADDING = 10;
const BANNER_W = 1200;
const BANNER_H = 630;
const BUCKET = process.env.AWS_BUCKET;
const REGION = process.env.AWS_REGION ?? "us-east-1";
const CDN = (process.env.CDN_BASE_URL ?? "https://cdn.thecouponchaser.com").replace(/\/$/, "");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

function makeS3() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

function slug(name) {
  return name.trim().replace(/\s+/g, "-");
}

async function detectBg(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pts = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
    [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)],
  ];
  let r = 0, g = 0, b = 0, a = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * channels;
    r += data[i]; g += data[i + 1] ?? data[i]; b += data[i + 2] ?? data[i];
    a += channels >= 4 ? data[i + 3] : 255;
  }
  const n = pts.length;
  if (channels >= 4 && a / n < 128) return { r: 255, g: 255, b: 255 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

async function generateImages(doc) {
  const brandName = String(doc.brandName ?? "brand");
  const logoUrl = String(doc.brandLogo);
  const s = slug(brandName);

  const fetchRes = await fetch(logoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; brand-processor/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!fetchRes.ok) throw new Error(`Fetch failed: ${fetchRes.status} ${logoUrl}`);
  const inputBuf = Buffer.from(await fetchRes.arrayBuffer());

  const meta = await sharp(inputBuf).metadata();
  const hasAlpha = (meta.channels ?? 3) >= 4;
  const outCh = hasAlpha ? 4 : 3;
  const bg = await detectBg(inputBuf);
  const bgFill = outCh === 4 ? { ...bg, alpha: 1 } : bg;

  let trimmed;
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

  return { s, squareBuf, bannerBuf };
}

async function uploadImages(s, squareBuf, bannerBuf) {
  const s3 = makeS3();
  const squareKey = `brand-logos/${s}-logo.png`;
  const bannerKey = `brand-logos/${s}-logo-og.jpg`;
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

async function main() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  const col = mongoClient.db("RawDB").collection("brand_migration");

  const docs = await col.find(
    { logo_pending: true },
    { projection: { brandName: 1, brandLogo: 1, _id: 1 } },
  ).toArray();

  console.log(`Found ${docs.length} logo_pending brands`);

  // Step 1: store all into Supabase as "skipped" so they're visible as queued
  const seen = new Set();
  const upsertRows = docs.flatMap((d) => {
    const name = String(d.brandName ?? d._id);
    if (seen.has(name)) return [];
    seen.add(name);
    return [{ brand_name: name, status: "skipped" }];
  });
  const PAGE = 200;
  for (let i = 0; i < upsertRows.length; i += PAGE) {
    const { error } = await supabase
      .from("brand_logos")
      .upsert(upsertRows.slice(i, i + PAGE), { onConflict: "brand_name" });
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
  console.log(`Stored ${docs.length} brands in Supabase brand_logos (status=skipped, will update to processed on success)`);
  console.log("─────────────────────────────────────────────────────");

  // Step 2: process each
  const processable = docs.filter((d) => d.brandLogo);
  const unprocessable = docs.filter((d) => !d.brandLogo);

  console.log(`Processable (have brandLogo): ${processable.length}`);
  console.log(`Skipping (no brandLogo):      ${unprocessable.length}`);
  console.log("─────────────────────────────────────────────────────");

  // Mark unprocessable as skipped in Supabase
  if (unprocessable.length > 0) {
    const skipRows = unprocessable.map((d) => ({
      brand_name: String(d.brandName ?? d._id),
      status: "skipped",
    }));
    await supabase.from("brand_logos").upsert(skipRows, { onConflict: "brand_name" });
    console.log(`Marked ${unprocessable.length} as skipped in Supabase`);
  }

  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < processable.length; i++) {
    const doc = processable[i];
    const name = String(doc.brandName ?? doc._id);
    const idx = `[${i + 1}/${processable.length}]`;
    process.stdout.write(`${idx} ${name.slice(0, 45).padEnd(45)} `);

    try {
      const { s, squareBuf, bannerBuf } = await generateImages(doc);
      const { squareUrl, bannerUrl } = await uploadImages(s, squareBuf, bannerBuf);

      await Promise.all([
        col.updateOne(
          { _id: doc._id },
          { $set: { brand_logo_png_url: squareUrl, og_image_jpg_url: bannerUrl }, $unset: { logo_pending: "" } },
        ),
        supabase.from("brand_logos").upsert(
          { brand_name: name, status: "processed" },
          { onConflict: "brand_name" },
        ),
      ]);

      console.log(`✓`);
      ok++;
    } catch (err) {
      const msg = err.message ?? "unknown";
      const isNetworkErr = msg.includes("Fetch failed") || msg.includes("Network");
      console.log(`✗  ${msg.slice(0, 80)}`);
      if (isNetworkErr) {
        await supabase.from("brand_logos").upsert(
          { brand_name: name, status: "skipped" },
          { onConflict: "brand_name" },
        ).catch(() => {});
        skipped++;
      } else {
        failed++;
      }
    }
  }

  console.log("─────────────────────────────────────────────────────");
  console.log(`Done. Processed: ${ok}  Skipped: ${skipped + unprocessable.length}  Failed: ${failed}`);

  await mongoClient.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
