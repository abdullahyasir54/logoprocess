"use client";

import { useState, useEffect, useCallback } from "react";

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
  og: string; // data URL
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

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/og-generate");
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

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
              {/* Source PNG */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Source PNG (brand_logo_png_url)</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.pngUrl}
                    alt="Source PNG"
                    className="max-w-full max-h-52 object-contain"
                  />
                </CheckerBox>
                <p className="text-xs text-zinc-400 font-mono truncate">{preview.pngUrl.split("/").pop()}</p>
              </div>

              {/* Generated OG */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Generated OG 1200×630 JPEG</p>
                <CheckerBox className="h-56">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.og}
                    alt="Generated OG"
                    className="max-w-full max-h-52 object-contain"
                  />
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
              <button
                onClick={() => setPreview(null)}
                disabled={confirming}
                className="rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                disabled={confirming}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {confirming ? <><Spinner /> Uploading…</> : (
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
        <div className="max-w-4xl mx-auto flex items-center justify-between">
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
        <div className="max-w-4xl mx-auto space-y-5">

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

          {/* Process next pending */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex items-center justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-800">Process next pending brand</p>
              <p className="text-xs text-zinc-400">
                Picks the next brand that has <code className="bg-zinc-100 px-1 rounded">brand_logo_png_url</code> but
                is missing <code className="bg-zinc-100 px-1 rounded">og_image_jpg_url</code>, generates the 1200×630 JPEG, and
                shows a preview for you to confirm.
              </p>
            </div>
            <button
              onClick={() => generatePreview()}
              disabled={generating || !stats || stats.pending === 0}
              className="flex items-center gap-2 shrink-0 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? <><Spinner /> Generating…</> : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Process One
                </>
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
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Preview
                  </>
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
                <a
                  href={lastResult.ogUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-emerald-600 hover:underline break-all"
                >
                  {lastResult.ogUrl}
                </a>
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">How it works</p>
            <ol className="space-y-1.5 text-xs text-zinc-500 list-decimal list-inside">
              <li>Reads <code className="bg-zinc-100 px-1 rounded">brand_migration</code> collection for brands with <code className="bg-zinc-100 px-1 rounded">brand_logo_png_url</code> set</li>
              <li>Fetches the square PNG from the CDN URL</li>
              <li>Detects background colour from corner pixels</li>
              <li>Centers the logo on a 1200×630 canvas with matching background, outputs JPEG</li>
              <li>Uploads to S3 with key derived from the PNG filename + <code className="bg-zinc-100 px-1 rounded">-og.jpg</code></li>
              <li>Saves the CDN URL back to <code className="bg-zinc-100 px-1 rounded">og_image_jpg_url</code> in MongoDB</li>
            </ol>
            <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-100 px-4 py-2.5 text-xs font-mono text-zinc-500">
              <span className="text-zinc-400">PNG: </span>cdn.thecouponchaser.com/brand-logos/Brand-Name-logo<span className="text-violet-500">.png</span>
              <br />
              <span className="text-zinc-400">OG:  </span>cdn.thecouponchaser.com/brand-logos/Brand-Name-logo<span className="text-emerald-500">-og.jpg</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
