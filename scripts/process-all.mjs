#!/usr/bin/env node
// Auto-processes every unprocessed logo in S3: trim → 10px pad → 1:1 square → upload back → record in Supabase.
// Run: npm run process-all
// Reads env from .env.local automatically.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env.local before anything else
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
try {
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
} catch {
  // .env.local not found — rely on environment variables already set
}

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const PADDING = 10;
const BUCKET = process.env.AWS_BUCKET ?? "thecouponchaser";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "brand-logos/";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

async function fetchBuffer(key) {
  const res = await makeS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.Body.on("data", (c) => chunks.push(Buffer.from(c)));
    res.Body.on("end", () => resolve(Buffer.concat(chunks)));
    res.Body.on("error", reject);
  });
}

async function processImage(inputBuffer) {
  const meta = await sharp(inputBuffer).metadata();
  const channels = meta.channels ?? 3;

  const { data: corner } = await sharp(inputBuffer)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bg = {
    r: corner[0], g: corner[1], b: corner[2],
    alpha: channels === 4 ? corner[3] / 255 : 1,
  };

  const trimmed = await sharp(inputBuffer).trim({ threshold: 10 }).toBuffer();
  const tm = await sharp(trimmed).metadata();
  const tw = tm.width ?? 0;
  const th = tm.height ?? 0;

  const padded = await sharp(trimmed)
    .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: bg })
    .toBuffer();

  const pw = tw + PADDING * 2;
  const ph = th + PADDING * 2;
  const sq = Math.max(pw, ph);

  const processed = await sharp({
    create: { width: sq, height: sq, channels: channels >= 4 ? 4 : 3, background: bg },
  })
    .composite([{ input: padded, left: Math.floor((sq - pw) / 2), top: Math.floor((sq - ph) / 2) }])
    .png()
    .toBuffer();

  return {
    processedBuffer: processed,
    originalSize: { width: meta.width ?? 0, height: meta.height ?? 0 },
    processedSize: { width: sq, height: sq },
  };
}

async function getAllKeys() {
  const s3 = makeS3();
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key !== PREFIX) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  console.log(`\nLogo Auto-Processor`);
  console.log(`Bucket : ${BUCKET} (${REGION})`);
  console.log(`Prefix : ${PREFIX}`);
  console.log(`───────────────────────────────────────`);
  console.log(`Fetching S3 keys and Supabase records…`);

  const [allKeys, { data: done, error: dbErr }] = await Promise.all([
    getAllKeys(),
    supabase.from("processed_logos").select("s3_key"),
  ]);

  if (dbErr) {
    console.error("ERROR fetching Supabase records:", dbErr.message);
    process.exit(1);
  }

  const doneSet = new Set((done ?? []).map((r) => r.s3_key));
  const pending = allKeys.filter((k) => !doneSet.has(k));

  console.log(`\nTotal in S3 : ${allKeys.length}`);
  console.log(`Already done: ${doneSet.size}`);
  console.log(`To process  : ${pending.length}`);
  console.log(`───────────────────────────────────────\n`);

  if (pending.length === 0) {
    console.log("Nothing to process. All logos are already done.");
    return;
  }

  const s3 = makeS3();
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const key = pending[i];
    const name = key.replace(PREFIX, "").replace(/-logo\.(png|jpg|jpeg|webp)$/i, "").replace(/-/g, " ");
    const idx = `[${i + 1}/${pending.length}]`;

    process.stdout.write(`${idx} ${name.padEnd(40)} `);

    try {
      const buf = await fetchBuffer(key);
      const { processedBuffer, originalSize, processedSize } = await processImage(buf);

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: processedBuffer,
          ContentType: "image/png",
        })
      );

      const { error: upsertErr } = await supabase.from("processed_logos").upsert({
        s3_key: key,
        status: "accepted",
        original_width: originalSize.width,
        original_height: originalSize.height,
        processed_width: processedSize.width,
        processed_height: processedSize.height,
      });

      if (upsertErr) throw new Error(upsertErr.message);

      console.log(`✓  ${originalSize.width}×${originalSize.height} → ${processedSize.width}×${processedSize.height}`);
      succeeded++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n───────────────────────────────────────`);
  console.log(`Done. Processed: ${succeeded}  Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
