import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { supabase } from "@/lib/supabase";

const BUCKET = process.env.AWS_BUCKET!;
const REGION = process.env.AWS_REGION ?? "us-east-1";

export async function POST(request: NextRequest) {
  try {
    const { key, action, processed, originalSize, processedSize } = await request.json();

    if (!key || !action) {
      return NextResponse.json({ error: "key and action are required" }, { status: 400 });
    }

    if (action === "accept") {
      if (!processed) {
        return NextResponse.json({ error: "processed image is required for accept" }, { status: 400 });
      }

      // Decode base64 and upload to S3, overwriting the original
      const base64Data = processed.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const s3 = new S3Client({
        region: REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: "image/png",
        })
      );
    }

    // Record in Supabase
    const { error } = await supabase.from("processed_logos").upsert(
      {
        s3_key: key,
        status: action === "accept" ? "accepted" : "rejected",
        original_width: originalSize?.width,
        original_height: originalSize?.height,
        processed_width: processedSize?.width,
        processed_height: processedSize?.height,
      },
      { onConflict: "s3_key" }
    );

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    console.error("[decide]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
