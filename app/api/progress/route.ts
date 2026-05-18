import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys } from "@/lib/logo-processor";

export const maxDuration = 30;

// Cache total so S3 ListObjects only runs once per hour
let cachedTotal = 0;
let cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000;

export async function GET() {
  const [{ count }, { data: recent }] = await Promise.all([
    supabase.from("processed_logos").select("*", { count: "exact", head: true }),
    supabase
      .from("processed_logos")
      .select("s3_key, processed_width, processed_height")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!cachedTotal || Date.now() - cachedAt > CACHE_TTL) {
    const keys = await getAllKeys();
    cachedTotal = keys.length;
    cachedAt = Date.now();
  }

  return NextResponse.json({
    total: cachedTotal,
    doneCount: count ?? 0,
    recent: recent ?? [],
  });
}
