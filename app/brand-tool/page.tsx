"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Stats {
  total: number;
  processed: number;
  pending: number;
}

interface BatchResult {
  name: string;
  slug: string;
  status: "ok" | "error";
  error?: string;
}

interface LogEntry extends BatchResult {
  id: number;
  ts: string;
}

interface BrandLogEntry {
  id: number;
  brand_name: string;
  status: "processed" | "skipped";
  created_at: string;
}

interface CronRun {
  id: number;
  trigger: string;
  processed: number;
  failed: number;
  remaining: number;
  elapsed_ms: number;
  error: string | null;
  created_at: string;
}

interface PreviewData {
  name: string;
  slug: string;
  square: string;  // data URL
  banner: string;  // data URL
  confirmPayload: Record<string, unknown>;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-400 shrink-0 w-10 text-right">{pct}%</span>
    </div>
  );
}

function CheckerBox({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-zinc-200 overflow-hidden ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
        backgroundSize: "20px 20px",
      }}
    >
      {children}
    </div>
  );
}

export default function BrandTool() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [reprocessName, setReprocessName] = useState("");
  const [done, setDone] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [brandLog, setBrandLog] = useState<BrandLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logIdRef = useRef(0);
  const runRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/brand-process");
      const data = await res.json();
      if (res.ok) setStats(data as Stats);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // Initial cron run log fetch
  useEffect(() => {
    supabase
      .from("cron_runs")
      .select("*")
      .in("trigger", ["cron-brand-0", "cron-brand-1", "cron-brand-2", "cron-brand-3", "cron-brand-4"])
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { if (data) setRuns(data as CronRun[]); });
  }, []);

  // Initial brand log fetch
  useEffect(() => {
    supabase
      .from("brand_logos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { if (data) setBrandLog(data as BrandLogEntry[]); });
  }, []);

  // Live: new brand processed/skipped
  useEffect(() => {
    const channel = supabase
      .channel("brand-logos-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "brand_logos" },
        (payload) => {
          setBrandLog((prev) => [payload.new as BrandLogEntry, ...prev].slice(0, 200));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Live: new cron-brand run logged
  useEffect(() => {
    const channel = supabase
      .channel("brand-cron-runs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cron_runs" },
        (payload) => {
          const row = payload.new as CronRun;
          if (!row.trigger.startsWith("cron-brand-")) return;
          setRuns((prev) => [row, ...prev].slice(0, 50));
          setStats((prev) => prev ? { ...prev, pending: row.remaining } : prev);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const addLog = (entries: BatchResult[]) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [
      ...prev,
      ...entries.map((e) => ({ ...e, id: ++logIdRef.current, ts })),
    ].slice(-200));
  };

  const runLoop = async () => {
    runRef.current = true;
    setRunning(true);
    setDone(false);
    setError(null);

    while (runRef.current) {
      try {
        const res = await fetch("/api/brand-process", { method: "POST" });
        const data = await res.json();

        if (!res.ok) { setError(data.error ?? "Server error"); break; }
        if (data.results?.length) addLog(data.results as BatchResult[]);
        setStats({ total: data.total, processed: data.totalProcessed, pending: data.pending });
        if (data.done) { setDone(true); break; }
      } catch {
        setError("Network error — stopping.");
        break;
      }
    }

    runRef.current = false;
    setRunning(false);
  };

  const stop = () => { runRef.current = false; };

  const fetchPreview = async (payload: Record<string, unknown>) => {
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Server error"); return; }
      setPreview({
        name: data.name,
        slug: data.slug,
        square: data.square,
        banner: data.banner,
        confirmPayload: payload,
      });
    } catch {
      setError("Network error.");
    } finally {
      setPreviewing(false);
    }
  };

  const confirmUpload = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const payload = preview.name
        ? { brandName: preview.name }
        : preview.confirmPayload;
      const res = await fetch("/api/brand-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Server error"); return; }
      if (data.results?.length) addLog(data.results as BatchResult[]);
      if (data.total !== undefined) setStats({ total: data.total, processed: data.totalProcessed, pending: data.pending });
      if (data.done) setDone(true);
      setPreview(null);
    } catch {
      setError("Network error.");
    } finally {
      setConfirming(false);
    }
  };

  const pct = stats && stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;
  const busy = previewing || confirming || running;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{preview.name}</p>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{preview.slug}-logo</p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 grid grid-cols-2 gap-6">
              {/* Square */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Square PNG</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.square} alt="Square preview" className="max-w-full max-h-52 object-contain" />
                </CheckerBox>
                <p className="text-xs text-zinc-400">Natural resolution · 1:1</p>
              </div>

              {/* Banner */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">1200×630 JPEG</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.banner} alt="Banner preview" className="max-w-full max-h-52 object-contain" />
                </CheckerBox>
                <p className="text-xs text-zinc-400">1200 × 630 px · OG image</p>
              </div>
            </div>

            <div className="px-6 pb-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                disabled={confirming}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {confirming ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Confirm &amp; Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">Brand Migration</h1>
              <p className="text-xs text-zinc-400">MongoDB → S3 · Square PNG + 1200×630 JPEG</p>
            </div>
          </div>

          {stats && (
            <div className="flex items-center gap-6">
              <div className="text-xs text-zinc-500 text-right leading-5">
                <span className="font-semibold text-zinc-800">{stats.processed.toLocaleString()}</span> processed
                <span className="mx-1.5 text-zinc-300">·</span>
                <span className="font-semibold text-zinc-800">{stats.pending.toLocaleString()}</span> remaining
                <span className="mx-1.5 text-zinc-300">·</span>
                <span className="text-zinc-400">{stats.total.toLocaleString()} total</span>
              </div>
              <div className="w-40">
                <ProgressBar value={stats.processed} max={stats.total} />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Controls */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex items-center justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-800">
                {done ? "All brands processed!" : running ? "Processing brands…" : "Ready to process"}
              </p>
              <p className="text-xs text-zinc-400">
                Fetches logo from <code className="bg-zinc-100 px-1 rounded">brandLogo</code>,
                uploads square PNG to <code className="bg-zinc-100 px-1 rounded">brand_logo_png_url</code>{" "}
                and 1200×630 JPEG to <code className="bg-zinc-100 px-1 rounded">og_image_jpg_url</code>.
                Processes {10} brands per batch.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => fetchPreview({ limit: 1 })}
                disabled={busy || done || !stats || stats.pending === 0}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Process One
                  </>
                )}
              </button>

              {running ? (
                <button
                  onClick={stop}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition"
                >
                  <span className="w-2 h-2 rounded-sm bg-zinc-500" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={runLoop}
                  disabled={done || busy || !stats || stats.pending === 0}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {done ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      All done
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Start Processing
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* Stats grid */}
          {stats && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total", value: stats.total, color: "text-zinc-800" },
                { label: "Processed", value: stats.processed, color: "text-emerald-600" },
                { label: "Remaining", value: stats.pending, color: "text-amber-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-zinc-200 shadow-sm px-5 py-4">
                  <p className="text-xs text-zinc-400 mb-1">{label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}

          {/* Force reprocess */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Force Reprocess</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={reprocessName}
                onChange={(e) => setReprocessName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reprocessName.trim() && fetchPreview({ brandName: reprocessName.trim() })}
                placeholder="Exact brand name, e.g. Church Source"
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:bg-white transition"
              />
              <button
                onClick={() => fetchPreview({ brandName: reprocessName.trim() })}
                disabled={busy || !reprocessName.trim()}
                className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {previewing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Preview &amp; Reprocess
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">Previews both images before uploading. Re-uploads even if already processed.</p>
          </div>

          {/* Brand log */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Brand Log</h2>
              <span className="text-xs text-zinc-400 tabular-nums">{brandLog.length} entries</span>
            </div>

            {brandLog.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-zinc-400">
                No brands processed yet. Entries will appear here in real time.
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-100 text-zinc-400 text-left">
                      <th className="px-4 py-2.5 font-medium">Time</th>
                      <th className="px-4 py-2.5 font-medium">Brand</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {brandLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-2 text-zinc-400 tabular-nums whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-700 font-medium max-w-[300px] truncate">
                          {entry.brand_name}
                        </td>
                        <td className="px-4 py-2">
                          {entry.status === "processed" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              processed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-zinc-400 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              skipped
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Cron run log */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Cron Run Log</h2>
              <span className="text-xs text-zinc-400 font-mono">5 workers · every minute</span>
            </div>

            {runs.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-zinc-400">
                No cron runs yet. Runs will appear here automatically.
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-100 text-zinc-400 text-left">
                      <th className="px-4 py-2.5 font-medium">Time</th>
                      <th className="px-4 py-2.5 font-medium">Worker</th>
                      <th className="px-4 py-2.5 font-medium">Processed</th>
                      <th className="px-4 py-2.5 font-medium">Failed</th>
                      <th className="px-4 py-2.5 font-medium">Remaining</th>
                      <th className="px-4 py-2.5 font-medium">Duration</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {runs.map((run) => (
                      <tr key={run.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-2 text-zinc-400 tabular-nums whitespace-nowrap">
                          {new Date(run.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-mono text-zinc-600">
                            {run.trigger.replace("cron-brand-", "w")}
                          </span>
                        </td>
                        <td className="px-4 py-2 tabular-nums font-medium text-emerald-600">{run.processed}</td>
                        <td className="px-4 py-2 tabular-nums text-red-500">{run.failed}</td>
                        <td className="px-4 py-2 tabular-nums text-zinc-500">{run.remaining}</td>
                        <td className="px-4 py-2 tabular-nums text-zinc-400">{(run.elapsed_ms / 1000).toFixed(1)}s</td>
                        <td className="px-4 py-2">
                          {run.error ? (
                            <span className="text-red-500 truncate max-w-[180px] block" title={run.error}>
                              {run.error}
                            </span>
                          ) : run.processed === 0 && run.remaining === 0 ? (
                            <span className="text-zinc-400">all done</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              ok
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Processing log */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Processing log</h2>
              {running && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Running
                </span>
              )}
            </div>

            {log.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-zinc-400">
                Log will appear here once processing starts.
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-100 text-zinc-400 text-left">
                      <th className="px-4 py-2.5 font-medium">Time</th>
                      <th className="px-4 py-2.5 font-medium">Brand</th>
                      <th className="px-4 py-2.5 font-medium">Slug</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {log.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-2 text-zinc-400 tabular-nums whitespace-nowrap">{entry.ts}</td>
                        <td className="px-4 py-2 text-zinc-700 font-medium max-w-[200px] truncate">{entry.name}</td>
                        <td className="px-4 py-2 font-mono text-zinc-400 max-w-[200px] truncate">{entry.slug}-logo</td>
                        <td className="px-4 py-2">
                          {entry.status === "ok" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              ok
                            </span>
                          ) : (
                            <span className="text-red-500 truncate max-w-[180px] block" title={entry.error}>
                              {entry.error ?? "error"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div ref={logEndRef} />
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
