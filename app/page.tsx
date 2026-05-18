"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface QueueItem {
  key: string;
  name: string;
  original: string;
  processed: string;
  originalSize: { width: number; height: number };
  processedSize: { width: number; height: number };
  total: number;
  doneCount: number;
}

function LogoPanel({ src, label, size }: { src: string; label: string; size: { width: number; height: number } }) {
  return (
    <div className="flex flex-col items-center gap-3 flex-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      <div
        className="w-full flex items-center justify-center rounded-2xl border border-zinc-200 overflow-hidden"
        style={{
          minHeight: 260,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
          backgroundSize: "20px 20px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="max-w-[260px] max-h-[260px] object-contain" />
      </div>
      <span className="text-xs text-zinc-400">{size.width} × {size.height}px</span>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-400 shrink-0">{value} / {max}</span>
    </div>
  );
}

export default function Home() {
  const [item, setItem] = useState<QueueItem | null>(null);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setItem(null);
    try {
      const res = await fetch("/api/queue");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      if (data.done) {
        setDone(true);
        setTotal(data.total);
        setDoneCount(data.processed);
      } else {
        setItem(data);
        setTotal(data.total);
        setDoneCount(data.doneCount);
        setDone(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNext(); }, [fetchNext]);

  // Live progress: re-count whenever processed_logos changes
  useEffect(() => {
    const channel = supabase
      .channel("logo-progress")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "processed_logos" },
        async () => {
          const { count } = await supabase
            .from("processed_logos")
            .select("*", { count: "exact", head: true });
          if (count !== null) setDoneCount(count);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const decide = async (action: "accept" | "reject") => {
    if (!item) return;
    setDeciding(true);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          action,
          processed: action === "accept" ? item.processed : undefined,
          originalSize: item.originalSize,
          processedSize: item.processedSize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      await fetchNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">Logo Review Queue</h1>
              <p className="text-xs text-zinc-400">Trim · 10px pad · 1×1 square</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs text-zinc-500 leading-5">
              <span className="font-semibold text-zinc-800">{doneCount}</span> processed
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-zinc-800">{Math.max(0, total - doneCount)}</span> remaining
            </div>
            <div className="w-36">
              <ProgressBar value={doneCount} max={total} />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl space-y-6">

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-zinc-400">
              <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm">Loading next logo…</p>
            </div>
          )}

          {/* All done */}
          {!loading && done && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-zinc-800">All logos reviewed!</p>
                <p className="text-sm text-zinc-400 mt-1">{total} logos processed</p>
              </div>
            </div>
          )}

          {/* Review card */}
          {!loading && item && (
            <>
              {/* Logo name + key */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 capitalize">{item.name}</h2>
                  <p className="text-xs text-zinc-400 mt-0.5 font-mono">{item.key}</p>
                </div>
                <span className="text-xs text-zinc-400">{doneCount + 1} of {total}</span>
              </div>

              {/* Before / After */}
              <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8">
                <div className="flex flex-col sm:flex-row items-stretch gap-8">
                  <LogoPanel src={item.original} label="Before" size={item.originalSize} />

                  {/* Divider */}
                  <div className="flex flex-col items-center justify-center gap-2 shrink-0">
                    <svg className="w-7 h-7 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <div className="text-xs text-zinc-400 text-center space-y-0.5">
                      <p>Trim</p>
                      <p>+10px</p>
                      <p>1×1</p>
                    </div>
                  </div>

                  <LogoPanel src={item.processed} label="After" size={item.processedSize} />
                </div>
              </div>

              {/* Accept / Reject */}
              <div className="flex gap-4">
                <button
                  onClick={() => decide("reject")}
                  disabled={deciding}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Reject — keep original
                </button>

                <button
                  onClick={() => decide("accept")}
                  disabled={deciding}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {deciding ? (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Accept — overwrite S3
                </button>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  );
}
