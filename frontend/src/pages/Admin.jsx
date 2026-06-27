import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Shield, MessageCircle, Users, Activity, LogOut, ArrowLeft, Sun, Moon,
  Download, Ban, ShieldCheck, FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { api, API_BASE } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import Avatar from "../components/Avatar";

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// Download an authenticated file from a backend path (uses localStorage token).
async function downloadCsv(path, fallbackName) {
  const token = localStorage.getItem("token");
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disp);
    const filename = match ? match[1] : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  } catch (e) {
    toast.error(`Export failed: ${e.message || e}`);
  }
}

export default function Admin() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [tab, setTab] = useState("conversations");
  const [search, setSearch] = useState("");
  const [banBusy, setBanBusy] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [s, u, c] = await Promise.all([
          api.get("/admin/stats"),
          api.get("/admin/users"),
          api.get("/admin/conversations"),
        ]);
        setStats(s.data);
        setUsers(u.data);
        setConversations(c.data);
      } catch (e) {
        // not admin
        navigate("/chat", { replace: true });
      }
    })();
  }, [navigate]);

  const openConversation = async (conv) => {
    setActiveConv(conv);
    setActiveMessages([]);
    try {
      const { data } = await api.get(`/admin/messages/${encodeURIComponent(conv.conversation_id)}`);
      setActiveMessages(data.messages || []);
    } catch { /* noop */ }
  };

  const toggleBan = async (u) => {
    if (u.role === "admin") return;
    setBanBusy((p) => ({ ...p, [u.id]: true }));
    try {
      const action = u.is_banned ? "unban" : "ban";
      const { data } = await api.post(`/admin/users/${u.id}/${action}`);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, ...data } : x)));
      toast.success(`@${u.username} ${u.is_banned ? "unbanned" : "banned"}`);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to update user";
      toast.error(typeof msg === "string" ? msg : "Failed to update user");
    } finally {
      setBanBusy((p) => ({ ...p, [u.id]: false }));
    }
  };

  const filteredConvs = conversations.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.participants.some((p) => p.username.toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q));
  });

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  });

  const onLogout = async () => { await logout(); navigate("/login", { replace: true }); };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" data-testid="admin-page">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/chat")} className="p-1.5 rounded-full hover:bg-accent" title="Back to chat" data-testid="admin-back-button">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="font-display font-bold text-sm">Admin Console</div>
            <div className="text-[11px] text-muted-foreground">@{user.username} · monitoring all activity</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => downloadCsv("/admin/users/export", "instachat-users.csv")}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary hover:bg-accent border border-border"
            data-testid="export-users-csv-button"
            title="Export all users to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Users CSV
          </button>
          <button
            onClick={() => downloadCsv("/admin/conversations/export", "instachat-conversations.csv")}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary hover:bg-accent border border-border"
            data-testid="export-conversations-csv-button"
            title="Export all conversations to CSV"
          >
            <FileDown className="w-3.5 h-3.5" />
            Conversations CSV
          </button>
          <button onClick={toggle} className="p-2 rounded-full hover:bg-accent" data-testid="theme-toggle">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={onLogout} className="p-2 rounded-full hover:bg-accent" data-testid="admin-logout-button">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
        <StatCard icon={<Users className="w-4 h-4" />} label="Total users" value={stats?.total_users ?? "—"} testid="stat-users" />
        <StatCard icon={<MessageCircle className="w-4 h-4" />} label="Conversations" value={stats?.total_conversations ?? "—"} testid="stat-convos" />
        <StatCard icon={<MessageCircle className="w-4 h-4" />} label="Messages" value={stats?.total_messages ?? "—"} testid="stat-messages" />
        <StatCard icon={<Activity className="w-4 h-4 text-[#10B981]" />} label="Online now" value={stats?.online_now ?? "—"} testid="stat-online" />
      </div>

      {/* Tabs + search + mobile export */}
      <div className="px-6 pb-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex gap-1 bg-secondary rounded-full p-1 w-fit">
          <TabBtn active={tab === "conversations"} onClick={() => setTab("conversations")} testid="tab-conversations">
            Conversations
          </TabBtn>
          <TabBtn active={tab === "users"} onClick={() => setTab("users")} testid="tab-users">
            Users
          </TabBtn>
        </div>
        <div className="flex flex-1 md:flex-none items-center gap-2 md:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username or email…"
            data-testid="admin-search-input"
            className="bg-secondary border border-border rounded-full px-4 py-2 text-sm w-full md:w-80 focus:outline-none focus:ring-1 focus:ring-[#0095F6]"
          />
          <button
            onClick={() =>
              tab === "users"
                ? downloadCsv("/admin/users/export", "instachat-users.csv")
                : downloadCsv("/admin/conversations/export", "instachat-conversations.csv")
            }
            className="sm:hidden inline-flex items-center justify-center p-2 rounded-full bg-secondary hover:bg-accent border border-border"
            title="Export CSV"
            data-testid="export-csv-mobile-button"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 px-6 pb-6 min-h-0">
        {/* List */}
        <div className="lg:col-span-5 border border-border rounded-2xl overflow-hidden flex flex-col bg-card">
          <div className="px-4 py-3 border-b border-border font-display font-semibold text-sm flex items-center justify-between">
            <span>{tab === "conversations" ? "All conversations" : "All users"}</span>
            <button
              onClick={() =>
                tab === "users"
                  ? downloadCsv("/admin/users/export", "instachat-users.csv")
                  : downloadCsv("/admin/conversations/export", "instachat-conversations.csv")
              }
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              data-testid="export-csv-inline-button"
              title="Download CSV"
            >
              <Download className="w-3 h-3" />
              CSV
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {tab === "conversations" ? (
              filteredConvs.length === 0 ? (
                <Empty label="No conversations yet." />
              ) : (
                filteredConvs.map((c) => {
                  const isActive = activeConv?.conversation_id === c.conversation_id;
                  const [a, b] = c.participants;
                  return (
                    <button
                      key={c.conversation_id}
                      onClick={() => openConversation(c)}
                      data-testid={`admin-conv-${c.conversation_id}`}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left ${isActive ? "bg-accent" : ""}`}
                    >
                      <div className="flex -space-x-2">
                        {a ? <Avatar username={a.username} size={36} /> : null}
                        {b ? <Avatar username={b.username} size={36} /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-display font-semibold truncate">
                          {c.participants.map((p) => p.username).join(" ↔ ")}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.last_message?.text || "—"}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {c.message_count} msg
                      </div>
                    </button>
                  );
                })
              )
            ) : (
              filteredUsers.length === 0 ? (
                <Empty label="No users." />
              ) : (
                filteredUsers.map((u) => (
                  <div
                    key={u.id}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 ${u.is_banned ? "opacity-70" : ""}`}
                    data-testid={`admin-user-${u.username}`}
                  >
                    <Avatar username={u.username} size={36} online={u.online} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-display font-semibold truncate flex items-center gap-2">
                        <span className={u.is_banned ? "line-through" : ""}>@{u.username}</span>
                        {u.role === "admin" ? (
                          <span className="text-[10px] uppercase tracking-wider bg-[#0095F6] text-white px-2 py-0.5 rounded-full">
                            admin
                          </span>
                        ) : null}
                        {u.is_banned ? (
                          <span
                            data-testid={`admin-user-${u.username}-banned-badge`}
                            className="text-[10px] uppercase tracking-wider bg-red-600 text-white px-2 py-0.5 rounded-full"
                          >
                            banned
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground hidden md:block">{formatTime(u.created_at)}</div>
                    {u.role !== "admin" ? (
                      <button
                        onClick={() => toggleBan(u)}
                        disabled={!!banBusy[u.id]}
                        data-testid={`admin-user-${u.username}-${u.is_banned ? "unban" : "ban"}-button`}
                        title={u.is_banned ? "Unban user" : "Ban user"}
                        className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                          u.is_banned
                            ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                            : "bg-red-600 text-white border-red-600 hover:bg-red-700"
                        }`}
                      >
                        {u.is_banned ? <ShieldCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                        {u.is_banned ? "Unban" : "Ban"}
                      </button>
                    ) : null}
                  </div>
                ))
              )
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-7 border border-border rounded-2xl overflow-hidden flex flex-col bg-card min-h-[300px]">
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <Shield className="w-10 h-10 mb-3 text-muted-foreground" strokeWidth={1.5} />
              <div className="font-display font-semibold">Select a conversation</div>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Pick any conversation on the left to read the full message history between its two users.
              </p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="flex -space-x-2">
                  {activeConv.participants.map((p) => (
                    <Avatar key={p.id} username={p.username} size={32} />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-display font-semibold truncate" data-testid="admin-active-convo-title">
                    {activeConv.participants.map((p) => p.username).join(" ↔ ")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {activeMessages.length} messages
                  </div>
                </div>
                <button
                  onClick={() =>
                    downloadCsv(
                      `/admin/messages/${encodeURIComponent(activeConv.conversation_id)}/export`,
                      `instachat-messages.csv`,
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary hover:bg-accent border border-border"
                  data-testid="export-conversation-messages-csv-button"
                  title="Export this conversation's messages to CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2" data-testid="admin-messages-container">
                {activeMessages.map((m) => {
                  const sender = activeConv.participants.find((p) => p.id === m.sender_id);
                  return (
                    <div key={m.id} className="flex gap-2 items-start">
                      <Avatar username={sender?.username || "?"} size={28} />
                      <div className="flex-1">
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-display font-semibold text-foreground">@{sender?.username || m.sender_id}</span>
                          {" · "}
                          {formatTime(m.created_at)}
                        </div>
                        <div className="text-sm bg-secondary inline-block px-3 py-1.5 rounded-2xl rounded-tl-sm mt-1 max-w-full break-words whitespace-pre-wrap">
                          {m.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, testid }) {
  return (
    <div className="border border-border rounded-2xl p-4 bg-card" data-testid={testid}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-display text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Empty({ label }) {
  return <div className="px-6 py-12 text-center text-xs text-muted-foreground">{label}</div>;
}
