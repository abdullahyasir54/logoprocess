"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface RecentItem {
  key: string;
  name: string;
  width: number;
  height: number;
}

const PREFIX = "brand-logos/";

function keyToName(key: string) {
  return key
    .replace(PREFIX, "")
    .replace(/-logo\.(png|jpg|jpeg|webp)$/i, "")
    .replace(/-/g, " ");
}

export default function Home() {
  const [total, setTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    fetch("/api/progress")
      .then((r) => r.json())
      .then((data) => {
        setTotal(data.total);
        setDoneCount(data.doneCount);
        setRecent(
          (data.recent ?? []).map((r: { s3_key: string; processed_width: number; processed_height: number }) => ({
            key: r.s3_key,
            name: keyToName(r.s3_key),
            width: r.processed_width,
            height: r.processed_height,
          }))
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Supabase Realtime — live updates as cron processes logos
  useEffect(() => {
    const channel = supabase
      .channel("logo-progress")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "processed_logos" },
        (payload) => {
          const row = payload.new as { s3_key: string; processed_width: number; processed_height: number };
          setDoneCount((n) => n + 1);
          setRecent((prev) =>
            [
              {
                key: row.s3_key,
                name: keyToName(row.s3_key),
                width: row.processed_width,
                height: row.processed_height,
              },
              ...prev,
            ].slice(0, 20)
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const remaining = Math.max(0, total - doneCount);
  const done = !loading && total > 0 && doneCount >= total;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">Logo Processor</h1>
              <p className="text-xs text-zinc-400">Trim · 10px pad · 1×1 square</p>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-4 flex-1 max-w-md">
            <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-zinc-500 shrink-0 tabular-nums">
              <span className="font-semibold text-zinc-800">{doneCount}</span> done
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-zinc-800">{remaining}</span> remaining
            </div>
          </div>

          {/* Status */}
          <div className="shrink-0">
            {loading && (
              <span className="text-xs text-zinc-400">Loading…</span>
            )}
            {!loading && done && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                All done
              </span>
            )}
            {!loading && !done && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Running every minute
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-6">

        {/* Done state */}
        {done && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-zinc-800">All logos processed!</p>
              <p className="text-sm text-zinc-400 mt-1">{total} logos trimmed, padded, and squared</p>
            </div>
          </div>
        )}

        {/* Stats cards */}
        {!loading && !done && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-zinc-200 px-5 py-4">
              <p className="text-xs text-zinc-400 mb-1">Total</p>
              <p className="text-2xl font-bold text-zinc-900 tabular-nums">{total}</p>
            </div>
            <div className="bg-white rounded-2xl border border-zinc-200 px-5 py-4">
              <p className="text-xs text-zinc-400 mb-1">Processed</p>
              <p className="text-2xl font-bold text-blue-600 tabular-nums">{doneCount}</p>
            </div>
            <div className="bg-white rounded-2xl border border-zinc-200 px-5 py-4">
              <p className="text-xs text-zinc-400 mb-1">Remaining</p>
              <p className="text-2xl font-bold text-zinc-900 tabular-nums">{remaining}</p>
            </div>
          </div>
        )}

        {/* Recent log */}
        {recent.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              Recently processed
            </h2>
            <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
              {recent.map((item) => (
                <div key={item.key} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                    <span className="text-sm font-medium text-zinc-800 capitalize">{item.name}</span>
                    <span className="text-xs font-mono text-zinc-400">{item.key.replace(PREFIX, "")}</span>
                  </div>
                  <span className="text-xs text-zinc-400 tabular-nums shrink-0">
                    {item.width}×{item.height}px
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && recent.length === 0 && !done && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400">
            <svg className="w-8 h-8 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Waiting for cron to start…</p>
          </div>
        )}

      </main>
    </div>
  );
}
