"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface LogoItem {
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

function imgSrc(key: string) {
  return `/api/image?key=${encodeURIComponent(key)}`;
}

function CheckerBox({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl border border-zinc-200 overflow-hidden ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
        backgroundSize: "20px 20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function Home() {
  const [total, setTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [current, setCurrent] = useState<LogoItem | null>(null);
  const [recent, setRecent] = useState<LogoItem[]>([]);
  const [loading, setLoading] = useState(true);

  function loadProgress() {
    fetch("/api/progress")
      .then((r) => r.json())
      .then((data) => {
        setTotal(data.total);
        setDoneCount(data.doneCount);
        const items: LogoItem[] = (data.recent ?? []).map(
          (r: { s3_key: string; processed_width: number; processed_height: number }) => ({
            key: r.s3_key,
            name: keyToName(r.s3_key),
            width: r.processed_width,
            height: r.processed_height,
          })
        );
        setRecent(items);
        if (items[0]) setCurrent(items[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  // Initial load + poll every 30s as fallback
  useEffect(() => {
    loadProgress();
    const interval = setInterval(loadProgress, 5_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Supabase Realtime — fires every time cron finishes a logo
  useEffect(() => {
    const channel = supabase
      .channel("logo-progress")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "processed_logos" },
        (payload) => {
          const row = payload.new as {
            s3_key: string;
            processed_width: number;
            processed_height: number;
          };
          const item: LogoItem = {
            key: row.s3_key,
            name: keyToName(row.s3_key),
            width: row.processed_width,
            height: row.processed_height,
          };
          setCurrent(item);
          setDoneCount((n) => n + 1);
          setRecent((prev) => [item, ...prev].slice(0, 20));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const remaining = Math.max(0, total - doneCount);
  const allDone = !loading && total > 0 && doneCount >= total;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-6">
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

          <div className="shrink-0">
            {!loading && allDone && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                All done
              </span>
            )}
            {!loading && !allDone && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Running every minute
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 space-y-6">

        {/* All done */}
        {allDone && (
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

        {/* Current logo */}
        {!allDone && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8">
            {current ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-900 capitalize">{current.name}</h2>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5">{current.key}</p>
                  </div>
                  <span className="text-xs text-zinc-400 tabular-nums">{doneCount} of {total}</span>
                </div>
                <CheckerBox className="w-full" style={{ minHeight: 300, height: 300 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={current.key}
                    src={imgSrc(current.key)}
                    alt={current.name}
                    className="max-w-[300px] max-h-[300px] object-contain"
                  />
                </CheckerBox>
                <p className="text-xs text-zinc-400 text-center mt-3">
                  {current.width} × {current.height}px
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-zinc-400">
                <svg className="w-7 h-7 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm">Waiting for cron to process first logo…</p>
              </div>
            )}
          </div>
        )}

        {/* Recent grid */}
        {recent.length > 1 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              Recently processed
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {recent.slice(1).map((item) => (
                <div key={item.key} className="bg-white rounded-xl border border-zinc-200 p-2 flex flex-col gap-2">
                  <CheckerBox className="w-full" style={{ minHeight: 72, height: 72 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc(item.key)}
                      alt={item.name}
                      className="max-w-[60px] max-h-[60px] object-contain"
                    />
                  </CheckerBox>
                  <p className="text-xs font-medium text-zinc-700 capitalize truncate px-1">{item.name}</p>
                  <p className="text-xs text-zinc-400 px-1">{item.width}×{item.height}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
