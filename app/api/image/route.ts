import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { makeS3, BUCKET } from "@/lib/logo-processor";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return new NextResponse("Missing key", { status: 400 });

  try {
    const res = await makeS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = res.Body as Readable;
      stream.on("data", (c) => chunks.push(Buffer.from(c)));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        "Content-Type": res.ContentType ?? "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
