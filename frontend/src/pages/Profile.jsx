import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Camera, Save, Sun, Moon, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import Avatar from "../components/Avatar";

export default function Profile() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const { theme, toggle } = useTheme();
  const fileInputRef = useRef(null);

  const [nickname, setNickname] = useState(user?.nickname || "");
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Track which fields the user has touched so we send only those — and so
  // sending `null` for nickname/avatar actively clears them server-side.
  const initialNick = user?.nickname || "";
  const initialAvatar = user?.avatar || null;
  const nickDirty = (nickname || "") !== initialNick;
  const avatarDirty = (avatar || null) !== initialAvatar;
  const dirty = nickDirty || avatarDirty;

  useEffect(() => {
    setNickname(user?.nickname || "");
    setAvatar(user?.avatar || null);
  }, [user]);

  const onPickAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please pick an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAvatar(data.path);
      toast.success("Picture ready — hit Save to apply");
    } catch (err) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = () => {
    setAvatar(null);
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const body = {};
      if (nickDirty) body.nickname = nickname.trim() || null;
      if (avatarDirty) body.avatar = avatar || null;
      const { data } = await api.patch("/users/me", body);
      setUser(data);
      toast.success("Profile updated");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not save profile";
      toast.error(typeof msg === "string" ? msg : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="profile-page">
      <header className="border-b border-border px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10">
        <button
          onClick={() => navigate("/chat")}
          data-testid="profile-back-button"
          className="inline-flex items-center gap-2 text-sm font-display font-semibold hover:text-[#0095F6] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to chat
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            data-testid="theme-toggle"
            className="p-2 rounded-full hover:bg-accent transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-8 py-10 space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Edit profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update what others see when they message you.
          </p>
        </div>

        {/* Avatar block */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Profile picture</div>
          <div className="flex items-center gap-6">
            <div data-testid="profile-avatar-preview">
              <Avatar
                username={user.username}
                nickname={nickname || user.nickname}
                avatar={avatar}
                size={96}
                ring
              />
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onPickAvatar}
                className="hidden"
                data-testid="profile-avatar-file-input"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="profile-pick-avatar-button"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary hover:bg-accent border border-border disabled:opacity-50"
              >
                <Camera className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : avatar ? "Change picture" : "Upload picture"}
              </button>
              {avatar ? (
                <button
                  onClick={removeAvatar}
                  data-testid="profile-remove-avatar-button"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full text-rose-600 hover:bg-rose-500/10 border border-transparent"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove picture
                </button>
              ) : null}
              <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
                PNG / JPG up to 5 MB. Square crops look best.
              </p>
            </div>
          </div>
        </section>

        {/* Nickname block */}
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Display name</div>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Your display name (e.g. Jashan P.)"
            maxLength={40}
            data-testid="profile-nickname-input"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
          />
          <p className="text-[11px] text-muted-foreground">
            This is what people see at the top of conversations and in your chat bubbles.
            Your @{user.username} handle stays the same.
            {nickname ? (
              <button
                type="button"
                onClick={() => setNickname("")}
                data-testid="profile-clear-nickname-button"
                className="ml-2 inline-flex items-center gap-1 text-rose-600 hover:underline"
              >
                <X className="w-3 h-3" />
                clear
              </button>
            ) : null}
          </p>
        </section>

        {/* Read-only username/email */}
        <section className="space-y-3 border-t border-border pt-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Account</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-secondary border border-border rounded-xl px-4 py-3" data-testid="profile-username-readonly">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Username</div>
              <div className="text-sm font-display font-semibold">@{user.username}</div>
            </div>
            <div className="bg-secondary border border-border rounded-xl px-4 py-3" data-testid="profile-email-readonly">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Email</div>
              <div className="text-sm truncate">{user.email}</div>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2 sticky bottom-4">
          <button
            onClick={save}
            disabled={!dirty || saving || uploading}
            data-testid="profile-save-button"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg hover:opacity-95 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
