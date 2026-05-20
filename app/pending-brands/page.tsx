"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Brand {
  id: string;
  name: string;
  logoUrl: string | null;
}

interface PreviewData {
  square: string;
  banner: string;
  slug: string;
}

type LocalStatus = "pending" | "done" | "skipped";

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function CheckerBox({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-zinc-200 overflow-hidden ${className}`}
      style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
        backgroundSize: "20px 20px",
      }}
    >
      {children}
    </div>
  );
}

export default function PendingBrands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({});
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFetchError, setIsFetchError] = useState(false);
  const [overrideUrl, setOverrideUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const overrideInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    fetch("/api/pending-brands")
      .then((r) => r.json())
      .then((data) => {
        setBrands(data.brands ?? []);
        setLoading(false);
      });
  }, []);

  const pendingBrands = brands.filter((b) => (localStatus[b.name] ?? "pending") === "pending");
  const doneCount = Object.values(localStatus).filter((s) => s === "done").length;

  const generatePreview = useCallback(async (name: string, url?: string) => {
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);
    setPreviewLoading(true);
    try {
      const body: Record<string, unknown> = { brandName: name, preview: true };
      if (url) body.logoUrl = url;
      const res = await fetch("/api/pending-brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error ?? "Failed to generate preview");
        setIsFetchError(!!data.fetchError);
        if (data.fetchError) setTimeout(() => overrideInputRef.current?.focus(), 50);
        return;
      }
      setPreview({ square: data.square, banner: data.banner, slug: data.slug });
    } catch {
      setPreviewError("Network error — could not reach server");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const selectBrand = useCallback((name: string) => {
    setSelectedName(name);
    setOverrideUrl("");
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);
    const brand = brands.find((b) => b.name === name);
    if (brand) {
      if (!brand.logoUrl) {
        setIsFetchError(true);
        setPreviewError("No source URL — provide one below");
        setTimeout(() => overrideInputRef.current?.focus(), 50);
      } else {
        generatePreview(name);
      }
    }
  }, [brands, generatePreview]);

  // Auto-select first pending brand once list loads
  useEffect(() => {
    if (!loading && brands.length > 0 && selectedName === null) {
      selectBrand(brands[0].name);
    }
  }, [loading, brands, selectedName, selectBrand]);

  // Scroll selected item into view
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedName]);

  const advanceToNext = useCallback((justDoneName: string) => {
    const remaining = brands.filter(
      (b) => b.name !== justDoneName && (localStatus[b.name] ?? "pending") === "pending",
    );
    if (remaining.length > 0) {
      setTimeout(() => selectBrand(remaining[0].name), 300);
    } else {
      setSelectedName(null);
    }
  }, [brands, localStatus, selectBrand]);

  const handleProcess = async () => {
    if (!selectedName) return;
    setProcessing(true);
    setProcessError(null);
    try {
      const body: Record<string, unknown> = { brandName: selectedName };
      if (overrideUrl.trim()) body.logoUrl = overrideUrl.trim();
      const res = await fetch("/api/pending-brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setProcessError(data.error ?? "Upload failed");
        return;
      }
      setLocalStatus((prev) => ({ ...prev, [selectedName]: "done" }));
      advanceToNext(selectedName);
    } catch {
      setProcessError("Network error — upload failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = () => {
    if (!selectedName) return;
    setLocalStatus((prev) => ({ ...prev, [selectedName]: "skipped" }));
    advanceToNext(selectedName);
  };

  const currentBrand = brands.find((b) => b.name === selectedName) ?? null;
  const allDone = !loading && pendingBrands.length === 0 && brands.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between max-w-full">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-900">Pending Brands</h1>
              <p className="text-xs text-zinc-400">Manual review — fetch logo → preview → process</p>
            </div>
          </div>
          {brands.length > 0 && (
            <div className="flex items-center gap-4">
              <div className="text-xs text-zinc-500 text-right leading-5">
                <span className="font-semibold text-emerald-600">{doneCount}</span> done this session
                <span className="mx-1.5 text-zinc-300">·</span>
                <span className="font-semibold text-zinc-800">{pendingBrands.length}</span> remaining
                <span className="mx-1.5 text-zinc-300">·</span>
                <span className="text-zinc-400">{brands.length} total</span>
              </div>
              <div className="w-36 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${brands.length > 0 ? Math.round((doneCount / brands.length) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 border-r border-zinc-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {loading ? "Loading…" : `${brands.length} brands`}
            </p>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-zinc-50">
            {loading ? (
              <li className="flex items-center justify-center py-16 text-zinc-400">
                <Spinner className="w-5 h-5" />
              </li>
            ) : brands.map((brand) => {
              const status = localStatus[brand.name] ?? "pending";
              const isSelected = selectedName === brand.name;
              return (
                <li
                  key={brand.id}
                  ref={isSelected ? selectedItemRef : undefined}
                  onClick={() => status === "pending" && selectBrand(brand.name)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors text-sm ${
                    isSelected
                      ? "bg-orange-50 border-l-2 border-orange-500"
                      : status === "done"
                      ? "opacity-50 cursor-default"
                      : status === "skipped"
                      ? "opacity-40 cursor-default"
                      : "hover:bg-zinc-50 border-l-2 border-transparent"
                  }`}
                >
                  {status === "done" ? (
                    <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : status === "skipped" ? (
                    <span className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  ) : (
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? "bg-orange-500" : "bg-zinc-300"}`} />
                  )}
                  <span className={`truncate ${isSelected ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
                    {brand.name}
                  </span>
                  {!brand.logoUrl && status === "pending" && (
                    <span className="ml-auto shrink-0 text-xs text-red-400 font-medium">no url</span>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-full text-zinc-400">
              <Spinner className="w-6 h-6" />
            </div>
          ) : allDone ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-zinc-800">All brands processed!</p>
              <p className="text-sm text-zinc-400">Every pending brand has been reviewed this session.</p>
            </div>
          ) : !currentBrand ? (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              Select a brand from the list to begin.
            </div>
          ) : (
            <div className="max-w-3xl space-y-6">

              {/* Brand info */}
              <div>
                <h2 className="text-xl font-bold text-zinc-900">{currentBrand.name}</h2>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-zinc-400">Source:</span>
                  {currentBrand.logoUrl ? (
                    <a
                      href={currentBrand.logoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-blue-500 hover:underline truncate max-w-md"
                    >
                      {currentBrand.logoUrl}
                    </a>
                  ) : (
                    <span className="text-xs text-red-400 font-medium">No source URL</span>
                  )}
                </div>
              </div>

              {/* Preview area */}
              <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                {previewLoading ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-24 text-zinc-400">
                    <Spinner className="w-6 h-6" />
                    <p className="text-sm">Fetching logo and generating previews…</p>
                  </div>
                ) : previewError ? (
                  <div className="p-6 space-y-4">
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{previewError}</span>
                    </div>

                    {isFetchError && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                          Provide an alternate logo URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            ref={overrideInputRef}
                            type="url"
                            value={overrideUrl}
                            onChange={(e) => setOverrideUrl(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && overrideUrl.trim() && generatePreview(currentBrand.name, overrideUrl.trim())}
                            placeholder="https://example.com/logo.png"
                            className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-orange-400 focus:bg-white transition font-mono"
                          />
                          <button
                            onClick={() => overrideUrl.trim() && generatePreview(currentBrand.name, overrideUrl.trim())}
                            disabled={!overrideUrl.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Re-generate
                          </button>
                        </div>
                        <p className="text-xs text-zinc-400">Enter a direct link to a PNG, SVG, or JPG logo file.</p>
                      </div>
                    )}
                  </div>
                ) : preview ? (
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Square PNG</p>
                        <CheckerBox className="h-48">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={preview.square} alt="Square" className="max-w-full max-h-44 object-contain" />
                        </CheckerBox>
                        <p className="text-xs text-zinc-400 font-mono">{preview.slug}-logo.png</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">OG Image 1200×630</p>
                        <CheckerBox className="h-48">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={preview.banner} alt="OG" className="max-w-full max-h-44 object-contain" />
                        </CheckerBox>
                        <p className="text-xs text-zinc-400 font-mono">{preview.slug}-logo-og.jpg</p>
                      </div>
                    </div>

                    {overrideUrl.trim() && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 font-mono">
                        Using override URL: {overrideUrl.trim()}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Process error */}
              {processError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {processError}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSkip}
                  disabled={processing}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                  Skip for now
                </button>

                <button
                  onClick={handleProcess}
                  disabled={processing || previewLoading || !preview}
                  className="flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {processing ? (
                    <><Spinner /> Uploading…</>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Process &amp; Save
                    </>
                  )}
                </button>

                {preview && (
                  <button
                    onClick={() => generatePreview(currentBrand.name, overrideUrl.trim() || undefined)}
                    disabled={previewLoading || processing}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 transition disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </button>
                )}
              </div>

            </div>
          )}
        </main>
      </div>
    </div>
  );
}
