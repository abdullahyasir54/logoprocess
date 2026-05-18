"use client";

import { useState, useRef } from "react";

interface Result {
  square: string;
  banner: string;
  squareSize: number;
  bgColor: { r: number; g: number; b: number };
}

function toHex(n: number) { return n.toString(16).padStart(2, "0"); }
function hexColor(c: { r: number; g: number; b: number }) {
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

function CheckerBox({ children, className = "", style }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-zinc-200 overflow-hidden ${className}`}
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

function DownloadButton({ dataUrl, filename }: { dataUrl: string; filename: string }) {
  return (
    <a
      href={dataUrl}
      download={filename}
      className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 transition"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      {filename}
    </a>
  );
}

export default function ImageTool() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const process = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/process-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Processing failed");
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const hex = result ? hexColor(result.bgColor) : null;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-zinc-900">Image Processor</h1>
            <p className="text-xs text-zinc-400">Trim · 10px pad · 1×1 square · 1280×630 banner</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* URL input */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6">
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              Image URL
            </label>
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && process()}
                placeholder="https://example.com/logo.png"
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-violet-400 focus:bg-white transition"
              />
              <button
                onClick={process}
                disabled={loading || !url.trim()}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Process
                  </>
                )}
              </button>
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

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-zinc-400">
              <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm">Fetching and processing image…</p>
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <div className="space-y-6">

              {/* Detected background color */}
              <div className="flex items-center gap-3 text-sm text-zinc-600">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Detected background</span>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-5 h-5 rounded border border-zinc-300 shadow-sm"
                    style={{ background: hex! }}
                  />
                  <span className="font-mono text-xs text-zinc-600">{hex}</span>
                  <span className="text-xs text-zinc-400">
                    rgb({result.bgColor.r}, {result.bgColor.g}, {result.bgColor.b})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Square */}
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">1×1 Square</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    <CheckerBox style={{ minHeight: 280 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={result.square}
                        alt="Square output"
                        className="max-w-[260px] max-h-[260px] object-contain"
                      />
                    </CheckerBox>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-zinc-400 tabular-nums">
                        {result.squareSize} × {result.squareSize}px
                      </p>
                      <DownloadButton dataUrl={result.square} filename="logo-square.png" />
                    </div>
                  </div>
                </div>

                {/* Banner */}
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">1280×630 Banner</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    <CheckerBox style={{ minHeight: 280 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={result.banner}
                        alt="Banner output"
                        className="w-full object-contain max-h-[260px]"
                      />
                    </CheckerBox>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-zinc-400 tabular-nums">1280 × 630px</p>
                      <DownloadButton dataUrl={result.banner} filename="logo-banner.png" />
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
