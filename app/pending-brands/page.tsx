"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Brand {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  status: "pending" | "skipped";
}

interface PreviewData {
  square: string;
  banner: string;
  slug: string;
}

type LocalStatus = "pending" | "done" | "skipped";
type Filter = "pending" | "skipped";

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
  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFetchError, setIsFetchError] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewData>>({});
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    fetch("/api/pending-brands")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const brandList: Brand[] = data.brands ?? [];
        setBrands(brandList);
        // Seed localStatus from Supabase statuses returned by the API
        const seed: Record<string, LocalStatus> = {};
        for (const b of brandList) {
          if (b.status === "skipped") seed[b.name] = "skipped";
        }
        setLocalStatus(seed);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load brands");
        setLoading(false);
      });
  }, []);

  const getStatus = useCallback((name: string, status: Record<string, LocalStatus>): LocalStatus =>
    status[name] ?? "pending", []);

  const filteredBrands = brands.filter((b) => getStatus(b.name, localStatus) === filter);
  const pendingCount = brands.filter((b) => getStatus(b.name, localStatus) === "pending").length;
  const skippedCount = brands.filter((b) => getStatus(b.name, localStatus) === "skipped").length;
  const doneCount = brands.filter((b) => getStatus(b.name, localStatus) === "done").length;

  const fetchPreviewData = useCallback(async (name: string, fileData?: string): Promise<PreviewData | null> => {
    const body: Record<string, unknown> = { brandName: name, preview: true };
    if (fileData) body.logoData = fileData;
    const res = await fetch("/api/pending-brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error ?? "Failed"), { fetchError: !!data.fetchError });
    return { square: data.square, banner: data.banner, slug: data.slug };
  }, []);

  const preloadBrand = useCallback(async (name: string, brandsList: Brand[], cache: Record<string, PreviewData>) => {
    const brand = brandsList.find((b) => b.name === name);
    if (!brand?.logoUrl || cache[name]) return;
    try {
      const result = await fetchPreviewData(name);
      if (result) setPreviewCache((prev) => ({ ...prev, [name]: result }));
    } catch { /* silent */ }
  }, [fetchPreviewData]);

  const generatePreview = useCallback(async (name: string, fileData?: string) => {
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);

    if (!fileData && previewCache[name]) {
      setPreview(previewCache[name]);
      return;
    }

    setPreviewLoading(true);
    try {
      const result = await fetchPreviewData(name, fileData);
      setPreview(result);
      if (!fileData && result) setPreviewCache((prev) => ({ ...prev, [name]: result }));
    } catch (err) {
      const e = err as Error & { fetchError?: boolean };
      setPreviewError(e.message);
      setIsFetchError(!!e.fetchError);
    } finally {
      setPreviewLoading(false);
    }
  }, [fetchPreviewData, previewCache]);

  const selectBrand = useCallback((name: string, brandsList?: Brand[], cache?: Record<string, PreviewData>) => {
    const list = brandsList ?? brands;
    const currentCache = cache ?? previewCache;
    setSelectedName(name);
    setUploadedFile(null);
    setPreview(null);
    setPreviewError(null);
    setIsFetchError(false);
    setProcessError(null);
    setCopied(false);
    const brand = list.find((b) => b.name === name);
    if (brand) {
      if (!brand.logoUrl) {
        setIsFetchError(true);
        setPreviewError("No source URL found — upload the logo below");
      } else {
        generatePreview(name);
      }
    }
    // Preload next pending brand in background
    const pendingList = list.filter((b) => !currentCache[b.name]);
    const idx = pendingList.findIndex((b) => b.name === name);
    const next = pendingList[idx + 1];
    if (next) preloadBrand(next.name, list, currentCache);
  }, [brands, previewCache, generatePreview, preloadBrand]);

  // Auto-select first brand on load
  useEffect(() => {
    if (!loading && brands.length > 0 && selectedName === null) {
      const firstPending = brands.find((b) => getStatus(b.name, localStatus) === "pending");
      if (firstPending) selectBrand(firstPending.name, brands, {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, brands]);

  // When filter changes, deselect if current brand is not in the new filter
  useEffect(() => {
    if (!selectedName) return;
    const status = localStatus[selectedName] ?? "pending";
    if (status !== filter) setSelectedName(null);
  }, [filter, selectedName, localStatus]);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedName]);

  const advanceToNext = useCallback((justDoneName: string, newStatus: LocalStatus, currentFilter: Filter) => {
    // Advance within the current filter's remaining list
    const remaining = brands.filter((b) => {
      if (b.name === justDoneName) return false;
      const s = localStatus[b.name] ?? "pending";
      return s === currentFilter;
    });
    if (remaining.length > 0) {
      setTimeout(() => selectBrand(remaining[0].name), 300);
    } else {
      setSelectedName(null);
    }
  }, [brands, localStatus, selectBrand]);

  const handleImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploadedFile({ name: file.name, dataUrl });
      if (selectedName) generatePreview(selectedName, dataUrl);
    };
    reader.readAsDataURL(file);
  }, [selectedName, generatePreview]);

  useEffect(() => {
    if (!isFetchError) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleImageFile(new File([file], `pasted-logo.${item.type.split("/")[1]}`, { type: item.type }));
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [isFetchError, handleImageFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImageFile(file);
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
      if (!res.ok) { setProcessError(data.error ?? "Upload failed"); return; }
      const name = selectedName;
      setLocalStatus((prev) => ({ ...prev, [name]: "done" }));
      advanceToNext(name, "done", filter);
    } catch {
      setProcessError("Network error — upload failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = async () => {
    if (!selectedName) return;
    const name = selectedName;
    // Optimistically update UI, then persist to Supabase
    setLocalStatus((prev) => ({ ...prev, [name]: "skipped" }));
    advanceToNext(name, "skipped", filter);
    await fetch("/api/pending-brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandName: name, skip: true }),
    }).catch(() => { /* non-blocking */ });
  };

  const currentBrand = brands.find((b) => b.name === selectedName) ?? null;
  const allDoneInFilter = !loading && filteredBrands.length === 0 && brands.length > 0;

  const websiteHref = currentBrand?.website
    ? currentBrand.website.startsWith("http") ? currentBrand.website : `https://${currentBrand.website}`
    : null;

  const switchFilter = (f: Filter) => {
    setFilter(f);
    setSelectedName(null);
    setPreview(null);
    setPreviewError(null);
  };

  return (
    <div className="h-screen bg-zinc-50 font-sans flex flex-col overflow-hidden">
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
          {!loading && brands.length > 0 && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span><span className="font-semibold text-emerald-600">{doneCount}</span> done</span>
                <span className="text-zinc-200">|</span>
                <span><span className="font-semibold text-amber-500">{skippedCount}</span> skipped</span>
                <span className="text-zinc-200">|</span>
                <span><span className="font-semibold text-zinc-800">{pendingCount}</span> pending</span>
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
          {/* Filter tabs */}
          <div className="flex border-b border-zinc-100 shrink-0">
            {(["pending", "skipped"] as Filter[]).map((f) => {
              const count = f === "pending" ? pendingCount : skippedCount;
              return (
                <button
                  key={f}
                  onClick={() => switchFilter(f)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
                    filter === f
                      ? f === "pending"
                        ? "text-orange-600 border-b-2 border-orange-500 bg-orange-50"
                        : "text-amber-600 border-b-2 border-amber-400 bg-amber-50"
                      : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {f === "pending" ? "Pending" : "Skipped"}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    filter === f
                      ? f === "pending" ? "bg-orange-100 text-orange-600" : "bg-amber-100 text-amber-600"
                      : "bg-zinc-100 text-zinc-400"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-zinc-50">
            {loading ? (
              <li className="flex items-center justify-center py-16 text-zinc-400">
                <Spinner className="w-5 h-5" />
              </li>
            ) : loadError ? (
              <li className="px-4 py-6 text-xs text-red-500">{loadError}</li>
            ) : filteredBrands.length === 0 ? (
              <li className="flex flex-col items-center justify-center gap-2 py-16 text-center px-4">
                <span className="text-2xl">{filter === "pending" ? "✓" : "—"}</span>
                <p className="text-xs text-zinc-400">
                  {filter === "pending" ? "No pending brands" : "No skipped brands"}
                </p>
              </li>
            ) : filteredBrands.map((brand) => {
              const isSelected = selectedName === brand.name;
              return (
                <li
                  key={brand.id}
                  ref={isSelected ? selectedItemRef : undefined}
                  onClick={() => selectBrand(brand.name)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors text-sm ${
                    isSelected
                      ? filter === "pending"
                        ? "bg-orange-50 border-l-2 border-orange-500"
                        : "bg-amber-50 border-l-2 border-amber-400"
                      : "hover:bg-zinc-50 border-l-2 border-transparent"
                  }`}
                >
                  {filter === "skipped" ? (
                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 uppercase tracking-wide">
                      skipped
                    </span>
                  ) : (
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? "bg-orange-500" : "bg-zinc-300"}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate ${isSelected ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
                      {brand.name}
                    </p>
                    {brand.website && (
                      <p className="text-xs text-zinc-400 truncate">{brand.website}</p>
                    )}
                  </div>
                  {!brand.logoUrl && (
                    <span className="ml-auto shrink-0 text-xs text-red-400 font-medium">no url</span>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-hidden px-8 py-8">
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
          ) : allDoneInFilter ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${filter === "pending" ? "bg-emerald-100" : "bg-zinc-100"}`}>
                <svg className={`w-8 h-8 ${filter === "pending" ? "text-emerald-600" : "text-zinc-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-zinc-800">
                {filter === "pending" ? "All caught up!" : "Nothing skipped yet"}
              </p>
              <p className="text-sm text-zinc-400">
                {filter === "pending"
                  ? skippedCount > 0 ? `You have ${skippedCount} skipped brand${skippedCount > 1 ? "s" : ""} to revisit.` : "Every brand has been processed."
                  : "Brands you skip will appear here."}
              </p>
              {filter === "pending" && skippedCount > 0 && (
                <button
                  onClick={() => switchFilter("skipped")}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition"
                >
                  View skipped brands →
                </button>
              )}
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
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-zinc-900">{currentBrand.name}</h2>
                    {localStatus[currentBrand.name] === "skipped" && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-600 uppercase tracking-wide">
                        skipped
                      </span>
                    )}
                  </div>
                  {websiteHref && (
                    <div className="inline-flex items-center gap-1.5 mt-1">
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {currentBrand.website}
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(currentBrand.website!);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="rounded p-1 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition"
                        title="Copy website"
                      >
                        {copied ? (
                          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
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
                  {filteredBrands.indexOf(currentBrand) + 1} / {filteredBrands.length}
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
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          onPaste={(e) => {
                            const items = e.clipboardData?.items;
                            if (!items) return;
                            for (const item of Array.from(items)) {
                              if (item.type.startsWith("image/")) {
                                const file = item.getAsFile();
                                if (file) handleImageFile(new File([file], `pasted-logo.${item.type.split("/")[1]}`, { type: item.type }));
                                break;
                              }
                            }
                          }}
                          tabIndex={0}
                          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors focus:outline-none focus:border-orange-400"
                        >
                          {uploadedFile ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={uploadedFile.dataUrl} alt="Uploaded" className="max-h-20 max-w-[160px] object-contain rounded-lg" />
                              <p className="text-sm font-medium text-zinc-700">{uploadedFile.name}</p>
                              <p className="text-xs text-zinc-400">Click to replace · or paste a new one</p>
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
                                <p className="text-xs text-zinc-400 mt-0.5">or paste from clipboard <kbd className="ml-1 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">⌘V</kbd></p>
                                <p className="text-xs text-zinc-300 mt-0.5">PNG, SVG, JPG, WebP</p>
                              </div>
                            </>
                          )}
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
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
                  {filter === "skipped" ? "Keep skipped" : "Skip for now"}
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
