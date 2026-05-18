import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys, processAndUpload, keyToName } from "@/lib/logo-processor";
import sharp from "sharp";

export const maxDuration = 60;

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

    const { buf, processedBuffer, originalSize, processedSize, format } =
      await processAndUpload(nextKey);

    const [previewOriginal, previewProcessed] = await Promise.all([
      sharp(buf).resize(400, 400, { fit: "inside" }).png().toBuffer(),
      sharp(processedBuffer).resize(400, 400, { fit: "inside" }).png().toBuffer(),
    ]);

    return NextResponse.json({
      done: false,
      key: nextKey,
      name: keyToName(nextKey),
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
