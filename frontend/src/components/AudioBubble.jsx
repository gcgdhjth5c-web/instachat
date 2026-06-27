import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/api";

export default function AudioBubble({ path, isMine }) {
  const [src, setSrc] = useState(null);
  const [duration, setDuration] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!path || !token) return;
    setSrc(`${API_BASE}/files/${path}?auth=${encodeURIComponent(token)}`);
  }, [path]);

  if (!src) return <div className="bg-secondary w-48 h-10 rounded-full animate-pulse" />;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${isMine ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-br-sm" : "bg-secondary text-foreground rounded-bl-sm"}`}
    >
      <audio
        ref={ref}
        src={src}
        controls
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        className="h-8"
        style={{ maxWidth: 220 }}
      />
      {duration ? (
        <span className={`text-[10px] ${isMine ? "text-white/80" : "text-muted-foreground"}`}>
          {Math.round(duration)}s
        </span>
      ) : null}
    </div>
  );
}
