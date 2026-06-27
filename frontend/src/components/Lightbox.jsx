import { useEffect } from "react";
import { X } from "lucide-react";
import { API_BASE } from "../lib/api";

export default function Lightbox({ path, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!path) return null;
  const token = localStorage.getItem("token");
  const src = `${API_BASE}/files/${path}?auth=${encodeURIComponent(token)}`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-6 animate-in"
      data-testid="lightbox"
    >
      <button
        onClick={onClose}
        data-testid="lightbox-close"
        className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt="preview"
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
      />
    </div>
  );
}
