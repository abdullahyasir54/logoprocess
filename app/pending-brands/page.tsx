"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Brand {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
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
  const [uploadedFile, setUploadedFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    fetch("/api/pending-brands")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBrands(data.brands ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load brands");
        setLoading(false);
      });
  }, []);

  const pendingBrands = brands.filter((b) => (localStatus[b.name] ?? "pending") === "pending");
  const doneCount = Object.values(localStatus).filter((s) => s === "done").length;

  const generatePreview = useCallback(async (name: string, fileData?: string) => {
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);
    setPreviewLoading(true);
    try {
      const body: Record<string, unknown> = { brandName: name, preview: true };
      if (fileData) body.logoData = fileData;
      const res = await fetch("/api/pending-brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error ?? "Failed to generate preview");
        setIsFetchError(!!data.fetchError);
        return;
      }
      setPreview({ square: data.square, banner: data.banner, slug: data.slug });
    } catch {
      setPreviewError("Network error — could not reach server");
      setIsFetchError(true);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const selectBrand = useCallback((name: string, brandsList?: Brand[]) => {
    const list = brandsList ?? brands;
    setSelectedName(name);
    setUploadedFile(null);
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);
    const brand = list.find((b) => b.name === name);
    if (brand) {
      if (!brand.logoUrl) {
        setIsFetchError(true);
        setPreviewError("No source URL found — upload the logo below");
      } else {
        generatePreview(name);
      }
    }
  }, [brands, generatePreview]);

  useEffect(() => {
    if (!loading && brands.length > 0 && selectedName === null) {
      selectBrand(brands[0].name, brands);
    }
  }, [loading, brands, selectedName, selectBrand]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploadedFile({ name: file.name, dataUrl });
      if (selectedName) generatePreview(selectedName, dataUrl);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  const handleProcess = async () => {
    if (!selectedName) return;
    setProcessing(true);
    setProcessError(null);
    try {
      const body: Record<string, unknown> = { brandName: selectedName };
      if (uploadedFile) body.logoData = uploadedFile.dataUrl;
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

  const websiteHref = currentBrand?.website
    ? currentBrand.website.startsWith("http") ? currentBrand.website : `https://${currentBrand.website}`
    : null;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
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
            ) : loadError ? (
              <li className="px-4 py-6 text-xs text-red-500">{loadError}</li>
            ) : brands.map((brand) => {
              const status = localStatus[brand.name] ?? "pending";
              const isSelected = selectedName === brand.name;
              return (
                <li
                  key={brand.id}
                  ref={isSelected ? selectedItemRef : undefined}
                  onClick={() => status === "pending" && selectBrand(brand.name)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 transition-colors text-sm ${
                    isSelected
                      ? "bg-orange-50 border-l-2 border-orange-500 cursor-default"
                      : status !== "pending"
                      ? "opacity-40 cursor-default border-l-2 border-transparent"
                      : "hover:bg-zinc-50 cursor-pointer border-l-2 border-transparent"
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
                  <div className="min-w-0">
                    <p className={`truncate ${isSelected ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
                      {brand.name}
                    </p>
                    {brand.website && (
                      <p className="text-xs text-zinc-400 truncate">{brand.website}</p>
                    )}
                  </div>
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
          ) : loadError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-red-600">Failed to load brands</p>
                <p className="text-xs text-zinc-400">{loadError}</p>
              </div>
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
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-zinc-900">{currentBrand.name}</h2>
                  {websiteHref && (
                    <a
                      href={websiteHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1 text-sm text-blue-500 hover:underline"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {currentBrand.website}
                    </a>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Logo source:</span>
                    {currentBrand.logoUrl ? (
                      <a href={currentBrand.logoUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-mono text-zinc-500 hover:text-blue-500 hover:underline truncate max-w-sm">
                        {currentBrand.logoUrl}
                      </a>
                    ) : (
                      <span className="text-xs text-red-400 font-medium">No source URL</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-zinc-400 tabular-nums pt-1">
                  {brands.indexOf(currentBrand) + 1} / {brands.length}
                </span>
              </div>

              {/* Preview area */}
              <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                {previewLoading ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-24 text-zinc-400">
                    <Spinner className="w-6 h-6" />
                    <p className="text-sm">Fetching logo and generating previews…</p>
                  </div>
                ) : previewError ? (
                  <div className="p-6 space-y-5">
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{previewError}</span>
                    </div>

                    {isFetchError && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Upload logo image</p>

                        {/* Drop zone */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors"
                        >
                          {uploadedFile ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={uploadedFile.dataUrl} alt="Uploaded" className="max-h-20 max-w-[160px] object-contain rounded-lg" />
                              <p className="text-sm font-medium text-zinc-700">{uploadedFile.name}</p>
                              <p className="text-xs text-zinc-400">Click to replace</p>
                            </>
                          ) : (
                            <>
                              <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                                <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-semibold text-zinc-700">Click to upload logo</p>
                                <p className="text-xs text-zinc-400 mt-0.5">PNG, SVG, JPG, WebP</p>
                              </div>
                            </>
                          )}
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </div>
                    )}
                  </div>
                ) : preview ? (
                  <div className="p-6 space-y-4">
                    {uploadedFile && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Using uploaded file: <span className="font-mono font-medium">{uploadedFile.name}</span>
                      </div>
                    )}
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
                  {processing ? <><Spinner /> Uploading…</> : (
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
                    onClick={() => generatePreview(currentBrand.name, uploadedFile?.dataUrl)}
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
