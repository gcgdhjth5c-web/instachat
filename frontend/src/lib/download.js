import { API_BASE } from "./api";

/**
 * Download an authenticated file (image/audio) from the backend's
 * /api/files/{path} endpoint and trigger a Save-to-disk in the browser.
 *
 * On mobile this typically lands in the device's Downloads (Android) or
 * Files / Photos (iOS, via long-press "Save Image" or the share sheet).
 */
export async function saveFileFromPath(path, suggestedName) {
  const token = localStorage.getItem("token");
  const url = `${API_BASE}/files/${path}${token ? `?auth=${encodeURIComponent(token)}` : ""}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = (path.split(".").pop() || "bin").toLowerCase();
  const filename = suggestedName || `instachat-${Date.now()}.${ext}`;
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  return filename;
}
