import { NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import sharp from "sharp";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

const PADDING = 10;
const BUCKET = process.env.AWS_BUCKET!;
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "brand-logos/";

function makeS3() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

async function fetchBuffer(key: string): Promise<Buffer> {
  const res = await makeS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = res.Body as Readable;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function getAllKeys(): Promise<string[]> {
  const s3 = makeS3();
  const keys: string[] = [];
  let token: string | undefined;
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

async function processImage(inputBuffer: Buffer) {
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

  const processedBuffer = await sharp({
    create: { width: sq, height: sq, channels: channels >= 4 ? 4 : 3, background: bg },
  })
    .composite([{ input: padded, left: Math.floor((sq - pw) / 2), top: Math.floor((sq - ph) / 2) }])
    .png()
    .toBuffer();

  return {
    processedBuffer,
    originalSize: { width: meta.width ?? 0, height: meta.height ?? 0 },
    processedSize: { width: sq, height: sq },
    format: meta.format ?? "png",
  };
}

export async function POST() {
  try {
    const [allKeys, { data: done }] = await Promise.all([
      getAllKeys(),
      supabase.from("processed_logos").select("s3_key"),
    ]);

    const total = allKeys.length;
    const doneSet = new Set((done ?? []).map((r) => r.s3_key));
    const nextKey = allKeys.find((k) => !doneSet.has(k));

    if (!nextKey) {
      return NextResponse.json({ done: true, total, processed: doneSet.size });
    }

    const buf = await fetchBuffer(nextKey);
    const { processedBuffer, originalSize, processedSize, format } = await processImage(buf);

    await makeS3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: nextKey,
        Body: processedBuffer,
        ContentType: "image/png",
      })
    );

    const { error } = await supabase.from("processed_logos").upsert({
      s3_key: nextKey,
      status: "accepted",
      original_width: originalSize.width,
      original_height: originalSize.height,
      processed_width: processedSize.width,
      processed_height: processedSize.height,
    });

    if (error) throw new Error(error.message);

    const name = nextKey
      .replace(PREFIX, "")
      .replace(/-logo\.(png|jpg|jpeg|webp)$/i, "")
      .replace(/-/g, " ");

    // Resize to max 400px for preview to keep response size small
    const [previewOriginal, previewProcessed] = await Promise.all([
      sharp(buf).resize(400, 400, { fit: "inside" }).png().toBuffer(),
      sharp(processedBuffer).resize(400, 400, { fit: "inside" }).png().toBuffer(),
    ]);

    return NextResponse.json({
      done: false,
      key: nextKey,
      name,
      original: `data:image/png;base64,${previewOriginal.toString("base64")}`,
      processed: `data:image/png;base64,${previewProcessed.toString("base64")}`,
      originalSize,
      processedSize,
      total,
      doneCount: doneSet.size + 1,
    });
  } catch (err) {
    console.error("[process-next]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
