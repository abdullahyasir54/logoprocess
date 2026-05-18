import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import sharp from "sharp";
import { supabase } from "./supabase";

export const BUCKET = process.env.AWS_BUCKET!;
export const REGION = process.env.AWS_REGION ?? "us-east-1";
export const PREFIX = "brand-logos/";
const PADDING = 10;

export function makeS3() {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function fetchBuffer(key: string): Promise<Buffer> {
  const res = await makeS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = res.Body as Readable;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function getAllKeys(): Promise<string[]> {
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

export async function processImage(inputBuffer: Buffer) {
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

export async function processAndUpload(key: string) {
  const buf = await fetchBuffer(key);
  const { processedBuffer, originalSize, processedSize, format } = await processImage(buf);

  await makeS3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: processedBuffer,
      ContentType: "image/png",
    })
  );

  const { error } = await supabase.from("processed_logos").upsert(
    {
      s3_key: key,
      status: "accepted",
      original_width: originalSize.width,
      original_height: originalSize.height,
      processed_width: processedSize.width,
      processed_height: processedSize.height,
    },
    { onConflict: "s3_key" }
  );

  if (error) throw new Error(error.message);

  return { buf, processedBuffer, originalSize, processedSize, format };
}

export function keyToName(key: string) {
  return key
    .replace(PREFIX, "")
    .replace(/-logo\.(png|jpg|jpeg|webp)$/i, "")
    .replace(/-/g, " ");
}

export async function getAllProcessedKeys(): Promise<Set<string>> {
  const PAGE = 1000;
  const keys = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("processed_logos")
      .select("s3_key")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) keys.add(row.s3_key);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return keys;
}
