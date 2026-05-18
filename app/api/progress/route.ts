import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAllKeys } from "@/lib/logo-processor";

export const maxDuration = 30;

export async function GET() {
  const [allKeys, { count }, { data: recent }] = await Promise.all([
    getAllKeys(),
    supabase.from("processed_logos").select("*", { count: "exact", head: true }),
    supabase
      .from("processed_logos")
      .select("s3_key, processed_width, processed_height")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    total: allKeys.length,
    doneCount: count ?? 0,
    recent: recent ?? [],
  });
}
