"use client";

import { useEffect, useState } from "react";

export function StoredFilePreview({ documentId, title }: { documentId: string; title: string }) {
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPages, setFailedPages] = useState<Record<number, true>>({});

  useEffect(() => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 15_000);
    fetch(`/documents/${documentId}/preview`, { signal: ac.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        const data = (await response.json()) as { pages?: number };
        const count = Number(data.pages) || 0;
        setError(null);
        setPages(count);
        if (count <= 0) {
          setError("This PDF has no pages that can be drawn on screen. Download the original instead.");
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setPages(0);
        setError("This PDF could not be drawn on screen. Download the original instead.");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [documentId]);

  return (
    <div className="space-y-3">
      {pages === null ? <p className="text-sm text-slate">Drawing the stored file…</p> : null}
      {error ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{error}</p>
      ) : null}
      {pages && pages > 0
        ? Array.from({ length: pages }, (_, index) => {
            const page = index + 1;
            if (failedPages[page]) {
              return (
                <p key={page} className="rounded-md border border-line bg-card px-4 py-3 text-sm text-slate">
                  Page {page} could not be drawn. Download the original PDF to view it outside this screen.
                </p>
              );
            }
            return (
              // Preview JPEGs are generated on this machine from the stored original.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={page}
                src={`/documents/${documentId}/preview/${page}`}
                alt={`${title} — page ${page} of ${pages}`}
                className="w-full rounded-xl border border-line bg-white"
                onError={() => setFailedPages((current) => ({ ...current, [page]: true }))}
              />
            );
          })
        : null}
    </div>
  );
}
