import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys, processAndUpload } from "@/lib/logo-processor";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const BUDGET_MS = 50_000; // stop at 50s to leave buffer before the 60s limit
  let processed = 0;
  let failed = 0;

  try {
    // Fetch key list + done set once for the whole batch
    const [allKeys, { data: done }] = await Promise.all([
      getAllKeys(),
      supabase.from("processed_logos").select("s3_key"),
    ]);

    const doneSet = new Set((done ?? []).map((r) => r.s3_key));
    const pending = allKeys.filter((k) => !doneSet.has(k));

    if (pending.length === 0) {
      return NextResponse.json({ done: true, total: allKeys.length });
    }

    for (const key of pending) {
      if (Date.now() - start > BUDGET_MS) break;
      try {
        await processAndUpload(key);
        processed++;
        // Add the key to doneSet so we don't re-check Supabase each iteration
        doneSet.add(key);
      } catch (err) {
        console.error(`[cron] failed ${key}:`, err);
        failed++;
      }
    }

    return NextResponse.json({
      processed,
      failed,
      remaining: pending.length - processed - failed,
      elapsed: Date.now() - start,
    });
  } catch (err) {
    console.error("[cron]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
