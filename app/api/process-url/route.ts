import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 30;

const PADDING = 10;
const BANNER_W = 1280;
const BANNER_H = 630;

async function detectBg(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Sample 4 corners + 4 edge midpoints
  const pts = [
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

  // Transparent edges → white background
  if (channels >= 4 && a / n < 128) {
    return { r: 255, g: 255, b: 255, alpha: 1 as const };
  }

  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
    alpha: 1 as const,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = body?.url ?? "";

    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "Only http/https URLs are supported" }, { status: 400 });
    }

    // Fetch
    let fetchRes: Response;
    try {
      fetchRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; image-processor/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return NextResponse.json({ error: "Could not reach the image URL" }, { status: 400 });
    }
    if (!fetchRes.ok) {
      return NextResponse.json({ error: `Image URL returned HTTP ${fetchRes.status}` }, { status: 400 });
    }

    const inputBuf = Buffer.from(await fetchRes.arrayBuffer());

    // Validate
    let meta: sharp.Metadata;
    try { meta = await sharp(inputBuf).metadata(); } catch {
      return NextResponse.json({ error: "URL does not point to a valid image" }, { status: 400 });
    }

    const hasAlpha = (meta.channels ?? 3) >= 4;
    const outChannels: 3 | 4 = hasAlpha ? 4 : 3;

    // Detect background
    const bg = await detectBg(inputBuf);
    const bgFill = outChannels === 4
      ? { r: bg.r, g: bg.g, b: bg.b, alpha: bg.alpha }
      : { r: bg.r, g: bg.g, b: bg.b };

    // Trim
    let trimmed: Buffer;
    try {
      trimmed = await sharp(inputBuf).trim({ threshold: 10 }).toBuffer();
    } catch {
      trimmed = inputBuf;
    }
    const tm = await sharp(trimmed).metadata();
    const tw = tm.width ?? 1;
    const th = tm.height ?? 1;

    // Pad
    const padded = await sharp(trimmed)
      .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: bgFill })
      .toBuffer();
    const pw = tw + PADDING * 2;
    const ph = th + PADDING * 2;
    const sq = Math.max(pw, ph);

    // 1×1 square at natural resolution
    const squareBuf = await sharp({
      create: { width: sq, height: sq, channels: outChannels, background: bgFill },
    })
      .composite([{ input: padded, left: Math.floor((sq - pw) / 2), top: Math.floor((sq - ph) / 2) }])
      .png()
      .toBuffer();

    // 1280×630 banner — logo centered, scaled to fit nicely
    const maxLogoH = Math.round(BANNER_H * 0.65); // ~409px
    const logoSize = Math.min(maxLogoH, Math.max(sq, Math.min(maxLogoH, sq * 2)));

    const scaledLogo = sq !== logoSize
      ? await sharp(squareBuf).resize(logoSize, logoSize, { fit: "fill", kernel: "lanczos3" }).toBuffer()
      : squareBuf;

    const bannerBuf = await sharp({
      create: { width: BANNER_W, height: BANNER_H, channels: outChannels, background: bgFill },
    })
      .composite([{
        input: scaledLogo,
        left: Math.floor((BANNER_W - logoSize) / 2),
        top: Math.floor((BANNER_H - logoSize) / 2),
      }])
      .png()
      .toBuffer();

    return NextResponse.json({
      square: `data:image/png;base64,${squareBuf.toString("base64")}`,
      banner: `data:image/png;base64,${bannerBuf.toString("base64")}`,
      squareSize: sq,
      bgColor: bg,
    });
  } catch (err) {
    console.error("[process-url]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 },
    );
  }
}
