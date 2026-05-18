import { NextResponse } from "next/server";

export const maxDuration = 60;
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import sharp from "sharp";
import { supabase } from "@/lib/supabase";

const PADDING = 10;
const BUCKET = process.env.AWS_BUCKET!;
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "brand-logos/";
const KEY_LIST_TTL_MS = 60 * 60 * 1000; // re-list S3 once per hour

// ── In-process cache (persists across requests in the same Node.js server) ──
let keyListCache: string[] = [];
let keyListFetchedAt = 0;

// Pre-processed next item: set after returning a queue response so the next
// GET can return immediately instead of waiting for S3 + Sharp.
type PreloadedItem = {
  key: string;
  name: string;
  original: string;
  processed: string;
  originalSize: { width: number; height: number };
  processedSize: { width: number; height: number };
};
let preloaded: PreloadedItem | null = null;
let preloading: Promise<void> | null = null;

// ────────────────────────────────────────────────────────────────────────────

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

async function getKeyList(): Promise<string[]> {
  if (keyListCache.length && Date.now() - keyListFetchedAt < KEY_LIST_TTL_MS) {
    return keyListCache;
  }
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
  keyListCache = keys;
  keyListFetchedAt = Date.now();
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
    format: meta.format ?? "png",
  };
}

async function buildItem(key: string): Promise<PreloadedItem> {
  const buf = await fetchBuffer(key);
  const { processedBuffer, originalSize, processedSize, format } = await processImage(buf);
  return {
    key,
    name: key.replace(PREFIX, "").replace(/-logo\.(png|jpg|jpeg|webp)$/i, "").replace(/-/g, " "),
    original: `data:image/${format};base64,${buf.toString("base64")}`,
    processed: `data:image/png;base64,${processedBuffer.toString("base64")}`,
    originalSize,
    processedSize,
  };
}

// Fire-and-forget: pre-process the logo AFTER `currentKey` so it's ready instantly.
function triggerPreload(currentKey: string) {
  if (preloading) return; // already in flight
  preloading = (async () => {
    try {
      // Fetch processed set fresh so we respect any decisions made since last load
      const [allKeys, { data: done }] = await Promise.all([
        getKeyList(),
        supabase.from("processed_logos").select("s3_key"),
      ]);
      const doneSet = new Set((done ?? []).map((r) => r.s3_key));
      doneSet.add(currentKey); // treat current as done (user is about to decide)
      const nextKey = allKeys.find((k) => !doneSet.has(k));
      preloaded = nextKey ? await buildItem(nextKey) : null;
    } catch (e) {
      console.error("[preload]", e);
      preloaded = null;
    } finally {
      preloading = null;
    }
  })();
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Fetch processed count for progress (cheap — just a count)
    const { count } = await supabase
      .from("processed_logos")
      .select("*", { count: "exact", head: true });

    const allKeys = await getKeyList();
    const total = allKeys.length;
    const doneCount = count ?? 0;

    // Return pre-processed item if ready
    if (preloaded) {
      const item = preloaded;
      preloaded = null;
      triggerPreload(item.key);
      return NextResponse.json({ done: false, ...item, total, doneCount });
    }

    // Wait if a preload is already in flight (avoids double-processing)
    if (preloading) await preloading;

    // Re-read module var after the await — TypeScript narrows it to null above
    const afterWait = preloaded as PreloadedItem | null;
    if (afterWait) {
      preloaded = null;
      triggerPreload(afterWait.key);
      return NextResponse.json({ done: false, ...afterWait, total, doneCount });
    }

    // Cold start: find next key and process it now
    const { data: done } = await supabase.from("processed_logos").select("s3_key");
    const doneSet = new Set((done ?? []).map((r) => r.s3_key));
    const nextKey = allKeys.find((k) => !doneSet.has(k));

    if (!nextKey) {
      return NextResponse.json({ done: true, total, processed: doneCount });
    }

    const item = await buildItem(nextKey);
    triggerPreload(nextKey); // start pre-processing the one after this
    return NextResponse.json({ done: false, ...item, total, doneCount });
  } catch (err) {
    console.error("[queue]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
