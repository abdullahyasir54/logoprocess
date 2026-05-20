"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Stats {
  total: number;
  processed: number;
  pending: number;
}

interface PreviewData {
  name: string;
  pngUrl: string;
  ogKey: string;
  ogCdnUrl: string;
  og: string;
}

interface OgLogEntry {
  id: number;
  brand_name: string;
  status: "processed" | "skipped";
  og_url: string | null;
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

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function OgTool() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [brandName, setBrandName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ name: string; ogUrl: string } | null>(null);
  const [ogLog, setOgLog] = useState<OgLogEntry[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/og-generate");
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Initial og_images log
  useEffect(() => {
    supabase
      .from("og_images")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { if (data) setOgLog(data as OgLogEntry[]); });
  }, []);

  // Initial cron run log
  useEffect(() => {
    supabase
      .from("cron_runs")
      .select("*")
      .in("trigger", ["cron-og-0", "cron-og-1", "cron-og-2", "cron-og-3", "cron-og-4"])
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { if (data) setRuns(data as CronRun[]); });
  }, []);

  // Live: new og_images entry
  useEffect(() => {
    const channel = supabase
      .channel("og-images-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "og_images" },
        (payload) => {
          setOgLog((prev) => [payload.new as OgLogEntry, ...prev].slice(0, 200));
          fetchStats();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchStats]);

  // Live: new cron-og run
  useEffect(() => {
    const channel = supabase
      .channel("og-cron-runs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cron_runs" },
        (payload) => {
          const row = payload.new as CronRun;
          if (!row.trigger.startsWith("cron-og-")) return;
          setRuns((prev) => [row, ...prev].slice(0, 50));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const generatePreview = async (target?: string) => {
    setGenerating(true);
    setError(null);
    setLastResult(null);
    try {
      const body: Record<string, unknown> = { preview: true };
      if (target) body.brandName = target;
      const res = await fetch("/api/og-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Server error"); return; }
      setPreview(data as PreviewData);
    } catch {
      setError("Network error.");
    } finally {
      setGenerating(false);
    }
  };

  const confirmUpload = async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (preview.name) body.brandName = preview.name;
      const res = await fetch("/api/og-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Server error"); return; }
      setLastResult({ name: data.name, ogUrl: data.ogUrl });
      setStats({ total: data.total, processed: data.processed, pending: data.pending });
      setPreview(null);
    } catch {
      setError("Network error.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{preview.name}</p>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{preview.ogKey}</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Source PNG</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.pngUrl} alt="Source PNG" className="max-w-full max-h-52 object-contain" />
                </CheckerBox>
                <p className="text-xs text-zinc-400 font-mono truncate">{preview.pngUrl.split("/").pop()}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Generated OG 1200×630</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.og} alt="Generated OG" className="max-w-full max-h-52 object-contain" />
                </CheckerBox>
                <p className="text-xs text-zinc-400 font-mono truncate">{preview.ogKey.split("/").pop()}</p>
              </div>
            </div>
            <div className="px-6 pb-4">
              <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-4 py-2.5 text-xs text-zinc-500 font-mono break-all">
                Will save → <span className="text-zinc-700">{preview.ogCdnUrl}</span>
              </div>
            </div>
            <div className="px-6 pb-6 flex items-center justify-end gap-3">
              <button onClick={() => setPreview(null)} disabled={confirming} className="rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmUpload} disabled={confirming} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50">
                {confirming ? <><Spinner /> Uploading…</> : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Confirm &amp; Upload</>
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
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">OG Image Generator</h1>
              <p className="text-xs text-zinc-400">brand_logo_png_url → 1200×630 JPEG → og_image_jpg_url</p>
            </div>
          </div>
          {stats && (
            <div className="text-xs text-zinc-500 text-right leading-5">
              <span className="font-semibold text-zinc-800">{stats.processed.toLocaleString()}</span> done
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="font-semibold text-amber-600">{stats.pending.toLocaleString()}</span> pending
              <span className="mx-1.5 text-zinc-300">·</span>
              <span className="text-zinc-400">{stats.total.toLocaleString()} total</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Have PNG URL", value: stats.total, color: "text-zinc-800" },
                { label: "OG Done", value: stats.processed, color: "text-emerald-600" },
                { label: "OG Pending", value: stats.pending, color: "text-amber-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl border border-zinc-200 shadow-sm px-5 py-4">
                  <p className="text-xs text-zinc-400 mb-1">{label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex items-center justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-800">Process next pending brand</p>
              <p className="text-xs text-zinc-400">
                Picks the next brand missing <code className="bg-zinc-100 px-1 rounded">og_image_jpg_url</code>, generates the 1200×630 JPEG, and shows a preview to confirm.
              </p>
            </div>
            <button
              onClick={() => generatePreview()}
              disabled={generating || !stats || stats.pending === 0}
              className="flex items-center gap-2 shrink-0 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? <><Spinner /> Generating…</> : (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Process One</>
              )}
            </button>
          </div>

          {/* Target specific brand */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Target Specific Brand</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && brandName.trim() && generatePreview(brandName.trim())}
                placeholder="Exact brand name, e.g. 1-Up Nutrition"
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-violet-400 focus:bg-white transition"
              />
              <button
                onClick={() => generatePreview(brandName.trim())}
                disabled={generating || !brandName.trim()}
                className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {generating ? <><Spinner /> Generating…</> : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>Preview</>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">Works even if the brand already has an OG image — useful for re-generating.</p>
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

          {/* Last result */}
          {lastResult && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-semibold">{lastResult.name} — uploaded successfully</p>
                <a href={lastResult.ogUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-emerald-600 hover:underline break-all">
                  {lastResult.ogUrl}
                </a>
              </div>
            </div>
          )}

          {/* OG brand log */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Brand Log</h2>
              <span className="text-xs text-zinc-400 tabular-nums">{ogLog.length} entries</span>
            </div>
            {ogLog.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-zinc-400">No entries yet. Will appear here in real time as crons run.</div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-100 text-zinc-400 text-left">
                      <th className="px-4 py-2.5 font-medium">Time</th>
                      <th className="px-4 py-2.5 font-medium">Brand</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">OG URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {ogLog.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-4 py-2 text-zinc-400 tabular-nums whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-700 font-medium max-w-[240px] truncate">{entry.brand_name}</td>
                        <td className="px-4 py-2">
                          {entry.status === "processed" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                              processed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-zinc-400 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              skipped
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 max-w-[200px] truncate">
                          {entry.og_url ? (
                            <a href={entry.og_url} target="_blank" rel="noopener noreferrer" className="text-violet-500 font-mono hover:underline">
                              {entry.og_url.split("/").pop()}
                            </a>
                          ) : (
                            <span className="text-zinc-300">—</span>
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
              <div className="px-5 py-10 text-center text-xs text-zinc-400">No cron runs yet. Runs will appear here automatically.</div>
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
                          <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-xs font-mono text-violet-600">
                            {run.trigger.replace("cron-og-", "w")}
                          </span>
                        </td>
                        <td className="px-4 py-2 tabular-nums font-medium text-emerald-600">{run.processed}</td>
                        <td className="px-4 py-2 tabular-nums text-red-500">{run.failed}</td>
                        <td className="px-4 py-2 tabular-nums text-zinc-500">{run.remaining}</td>
                        <td className="px-4 py-2 tabular-nums text-zinc-400">{(run.elapsed_ms / 1000).toFixed(1)}s</td>
                        <td className="px-4 py-2">
                          {run.error ? (
                            <span className="text-red-500 truncate max-w-[180px] block" title={run.error}>{run.error}</span>
                          ) : run.processed === 0 && run.remaining === 0 ? (
                            <span className="text-zinc-400">all done</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
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

        </div>
      </main>
    </div>
  );
}
