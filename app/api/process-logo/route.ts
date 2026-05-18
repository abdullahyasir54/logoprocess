import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
import sharp from "sharp";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const PADDING = 10;

import { Readable } from "stream";

async function processImage(inputBuffer: Buffer): Promise<{
  processedBuffer: Buffer;
  originalMeta: { width: number; height: number; format: string };
  processedSize: { width: number; height: number };
}> {
  const originalMeta = await sharp(inputBuffer).metadata();
  const channels = originalMeta.channels ?? 3;

  // Sample corner pixel to detect background color
  const { data: corner } = await sharp(inputBuffer)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bgColor = {
    r: corner[0],
    g: corner[1],
    b: corner[2],
    alpha: channels === 4 ? corner[3] / 255 : 1,
  };

  // Trim residual whitespace border (uses corner pixel as reference by default)
  const trimmed = await sharp(inputBuffer)
    .trim({ threshold: 10 })
    .toBuffer();

  const trimmedMeta = await sharp(trimmed).metadata();
  const tw = trimmedMeta.width ?? 0;
  const th = trimmedMeta.height ?? 0;

  // Add 10px padding using the same background color
  const padded = await sharp(trimmed)
    .extend({
      top: PADDING,
      bottom: PADDING,
      left: PADDING,
      right: PADDING,
      background: bgColor,
    })
    .toBuffer();

  const pw = tw + PADDING * 2;
  const ph = th + PADDING * 2;

  // Expand shorter side to make 1:1 square, centering the content
  const squareSize = Math.max(pw, ph);
  const xOffset = Math.floor((squareSize - pw) / 2);
  const yOffset = Math.floor((squareSize - ph) / 2);

  const processedBuffer = await sharp({
    create: {
      width: squareSize,
      height: squareSize,
      channels: channels >= 4 ? 4 : 3,
      background: bgColor,
    },
  })
    .composite([{ input: padded, left: xOffset, top: yOffset }])
    .png()
    .toBuffer();

  return {
    processedBuffer,
    originalMeta: {
      width: originalMeta.width ?? 0,
      height: originalMeta.height ?? 0,
      format: originalMeta.format ?? "png",
    },
    processedSize: { width: squareSize, height: squareSize },
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const source = formData.get("source") as string;

    let inputBuffer: Buffer;
    let filename = "logo.png";

    if (source === "s3") {
      const bucket = (formData.get("bucket") as string) || process.env.AWS_BUCKET || "";
      const key = formData.get("key") as string;
      const region = (formData.get("region") as string) || process.env.AWS_REGION || "us-east-1";
      const accessKeyId = (formData.get("accessKeyId") as string) || process.env.AWS_ACCESS_KEY_ID || "";
      const secretAccessKey = (formData.get("secretAccessKey") as string) || process.env.AWS_SECRET_ACCESS_KEY || "";

      if (!bucket || !key) {
        return NextResponse.json({ error: "Bucket and key are required" }, { status: 400 });
      }

      const s3 = new S3Client({
        region,
        credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
      });

      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) {
        return NextResponse.json({ error: "Empty response from S3" }, { status: 500 });
      }

      const nodeStream = response.Body as Readable;
      inputBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        nodeStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        nodeStream.on("end", () => resolve(Buffer.concat(chunks)));
        nodeStream.on("error", reject);
      });
      filename = key.split("/").pop() ?? "logo.png";
    } else {
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      inputBuffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    }

    const { processedBuffer, originalMeta, processedSize } = await processImage(inputBuffer);

    const originalBase64 = `data:image/${originalMeta.format};base64,${inputBuffer.toString("base64")}`;
    const processedBase64 = `data:image/png;base64,${processedBuffer.toString("base64")}`;

    return NextResponse.json({
      original: originalBase64,
      processed: processedBase64,
      originalSize: { width: originalMeta.width, height: originalMeta.height },
      processedSize,
      filename: filename.replace(/\.[^.]+$/, "_processed.png"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    console.error("[process-logo]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
