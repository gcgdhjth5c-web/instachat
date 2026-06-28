import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../lib/api";
import { saveFileFromPath } from "../lib/download";

// Image rendered from object storage. Uses query-param auth so plain <img> tags work.
export default function ChatImage({ path, alt = "image", onClick }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");
    if (!path || !token) return;
    const url = `${API_BASE}/files/${path}?auth=${encodeURIComponent(token)}`;
    if (!cancelled) setSrc(url);
    return () => { cancelled = true; };
  }, [path]);

  const handleSave = async (e) => {
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    try {
      const name = await saveFileFromPath(path);
      toast.success(`Saved ${name}`);
    } catch (err) {
      toast.error(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="bg-secondary text-muted-foreground text-xs px-3 py-2 rounded-xl">
        Image unavailable
      </div>
    );
  }
  if (!src) return <div className="bg-secondary w-48 h-48 rounded-xl animate-pulse" />;
  return (
    <div className="relative inline-block group/img">
      <img
        src={src}
        alt={alt}
        onError={() => setError(true)}
        onClick={onClick}
        className="max-w-[280px] max-h-[320px] rounded-2xl object-cover cursor-zoom-in border border-border"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        data-testid="chat-image-save-button"
        title="Save to device"
        aria-label="Save image to device"
        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/55 text-white opacity-0 group-hover/img:opacity-100 focus:opacity-100 transition-opacity backdrop-blur-sm hover:bg-black/75 disabled:opacity-50"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
