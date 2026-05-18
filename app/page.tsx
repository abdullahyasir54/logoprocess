"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface LogoItem {
  key: string;
  name: string;
  original: string;
  processed: string;
  originalSize: { width: number; height: number };
  processedSize: { width: number; height: number };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function CheckerPanel({
  src,
  label,
  size,
}: {
  src: string;
  label: string;
  size: { width: number; height: number };
}) {
  return (
    <div className="flex flex-col items-center gap-2 flex-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      <div
        className="w-full flex items-center justify-center rounded-xl border border-zinc-200 overflow-hidden"
        style={{
          minHeight: 200,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
          backgroundSize: "20px 20px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="max-w-[200px] max-h-[200px] object-contain" />
      </div>
      <span className="text-xs text-zinc-400">{size.width} × {size.height}px</span>
    </div>
  );
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-blue-500`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function Home() {
  const [status, setStatus] = useState<"running" | "paused" | "done">("running");
  const [total, setTotal] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [current, setCurrent] = useState<LogoItem | null>(null);
  const [recent, setRecent] = useState<LogoItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const runRef = useRef(true);

  // Supabase Realtime — keeps count accurate across tabs
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

  // Load initial count
  useEffect(() => {
    supabase
      .from("processed_logos")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => { if (count !== null) setDoneCount(count); });
  }, []);

  // Processing loop
  async function startLoop() {
    runRef.current = true;
    setStatus("running");
    setErrorMsg(null);

    while (runRef.current) {
      try {
        const res = await fetch("/api/process-next", { method: "POST" });
        const data = await res.json();

        if (!res.ok) {
          setErrorMsg(data.error ?? "Error — retrying in 3s…");
          await sleep(3000);
          continue;
        }

        setErrorMsg(null);

        if (data.done) {
          setTotal(data.total);
          setStatus("done");
          setCurrent(null);
          runRef.current = false;
          break;
        }

        const item: LogoItem = {
          key: data.key,
          name: data.name,
          original: data.original,
          processed: data.processed,
          originalSize: data.originalSize,
          processedSize: data.processedSize,
        };

        setTotal(data.total);
        setCurrent(item);
        setRecent((prev) => [item, ...prev].slice(0, 16));
      } catch {
        setErrorMsg("Network error — retrying in 3s…");
        await sleep(3000);
      }
    }
  }

  // Auto-start on mount — run 3 parallel loops for throughput
  useEffect(() => {
    const PARALLEL = 3;
    Array.from({ length: PARALLEL }).forEach((_, i) => {
      setTimeout(() => { if (runRef.current) startLoop(); }, i * 800);
    });
    return () => { runRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const remaining = Math.max(0, total - doneCount);

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

          {/* Progress bar + counts */}
          <div className="flex items-center gap-4 flex-1 max-w-md">
            <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-zinc-500 shrink-0 text-right">
              <span className="font-semibold text-zinc-800">{doneCount}</span> done
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-zinc-800">{remaining}</span> remaining
            </div>
          </div>

          {/* Status + controls */}
          <div className="flex items-center gap-2 shrink-0">
            {status === "running" && (
              <>
                <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                  <Spinner className="w-3 h-3" /> Processing
                </span>
                <button
                  onClick={() => { runRef.current = false; setStatus("paused"); }}
                  className="ml-2 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition"
                >
                  Pause
                </button>
              </>
            )}
            {status === "paused" && (
              <>
                <span className="text-xs text-zinc-400 font-medium">Paused</span>
                <button
                  onClick={() => startLoop()}
                  className="ml-2 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  Resume
                </button>
              </>
            )}
            {status === "done" && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                All done
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        {/* Error banner */}
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMsg}
          </div>
        )}

        {/* Currently processing */}
        {current && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              {status === "running" && <Spinner />}
              <p className="text-sm text-zinc-500">
                {status === "running" ? "Processing" : "Last processed"} —
              </p>
              <p className="text-sm font-semibold text-zinc-900 capitalize">{current.name}</p>
              <p className="ml-auto text-xs font-mono text-zinc-400">{current.key}</p>
            </div>
            <div className="flex items-center gap-6">
              <CheckerPanel src={current.original} label="Before" size={current.originalSize} />
              <div className="flex flex-col items-center gap-1 shrink-0 text-zinc-300">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                <span className="text-xs text-zinc-400 text-center leading-tight">
                  Trim<br />+10px<br />1×1
                </span>
              </div>
              <CheckerPanel src={current.processed} label="After" size={current.processedSize} />
            </div>
          </div>
        )}

        {/* All done */}
        {status === "done" && (
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

        {/* Recent items grid */}
        {recent.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              Recently processed
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {recent.map((item) => (
                <div
                  key={item.key}
                  className="bg-white rounded-xl border border-zinc-200 p-3 flex flex-col gap-2"
                >
                  <div
                    className="w-full flex items-center justify-center rounded-lg overflow-hidden"
                    style={{
                      height: 80,
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
                      backgroundSize: "20px 20px",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.processed}
                      alt={item.name}
                      className="max-w-[72px] max-h-[72px] object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-700 capitalize truncate">{item.name}</p>
                    <p className="text-xs text-zinc-400">
                      {item.processedSize.width}×{item.processedSize.height}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
