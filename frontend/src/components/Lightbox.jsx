import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../lib/api";
import { saveFileFromPath } from "../lib/download";

export default function Lightbox({ path, onClose }) {
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!path) return null;
  const token = localStorage.getItem("token");
  const src = `${API_BASE}/files/${path}?auth=${encodeURIComponent(token)}`;

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

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-6 animate-in"
      data-testid="lightbox"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          data-testid="lightbox-save"
          title="Save to device"
          className="text-white p-2 rounded-full hover:bg-white/10 disabled:opacity-50 inline-flex items-center gap-1.5 text-xs font-semibold"
        >
          <Download className="w-5 h-5" />
          <span className="hidden sm:inline">Save</span>
        </button>
        <button
          onClick={onClose}
          data-testid="lightbox-close"
          className="text-white p-2 rounded-full hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <img
        src={src}
        alt="preview"
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
      />
    </div>
  );
}
