import { useEffect, useState } from "react";
import { api, API_BASE } from "../lib/api";

// Image rendered from object storage. Uses query-param auth so plain <img> tags work.
export default function ChatImage({ path, alt = "image", onClick }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");
    if (!path || !token) return;
    // Direct URL with auth query (no header needed on <img>)
    const url = `${API_BASE}/files/${path}?auth=${encodeURIComponent(token)}`;
    if (!cancelled) setSrc(url);
    return () => { cancelled = true; };
  }, [path]);

  if (error) {
    return (
      <div className="bg-secondary text-muted-foreground text-xs px-3 py-2 rounded-xl">
        Image unavailable
      </div>
    );
  }
  if (!src) return <div className="bg-secondary w-48 h-48 rounded-xl animate-pulse" />;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setError(true)}
      onClick={onClick}
      className="max-w-[280px] max-h-[320px] rounded-2xl object-cover cursor-zoom-in border border-border"
    />
  );
}
