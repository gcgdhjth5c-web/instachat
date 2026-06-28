import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MessageCircle, Sun, Moon, LogOut, Send, Smile, Shield, ArrowLeft, Check, CheckCheck, Image as ImageIcon, SmilePlus, Mic, StopCircle, Reply, X } from "lucide-react";
import { toast } from "sonner";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useSocket } from "../context/SocketContext";
import Avatar from "../components/Avatar";
import ChatImage from "../components/ChatImage";
import AudioBubble from "../components/AudioBubble";
import Lightbox from "../components/Lightbox";

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { subscribe, send: wsSend, onlineUsers } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [typingFrom, setTypingFrom] = useState(null);
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reactionTargetId, setReactionTargetId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [lightboxPath, setLightboxPath] = useState(null);

  const scrollRef = useRef(null);
  const typingTimerRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const fileInputRef = useRef(null);
  const activeUserRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => { activeUserRef.current = activeUser; }, [activeUser]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ---------- Load conversations ----------
  const loadConversations = async () => {
    try {
      const { data } = await api.get("/conversations");
      setConversations(data);
    } catch { /* noop */ }
  };

  useEffect(() => { loadConversations(); }, []);

  // ---------- Live user search ----------
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (searchQuery.trim().length === 0) { setSearchResults([]); return; }
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(searchQuery.trim())}`);
        if (!cancelled) setSearchResults(data);
      } catch { /* noop */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  // ---------- Open conversation ----------
  const openChatWith = async (otherUser) => {
    setActiveUser(otherUser);
    setShowSidebarMobile(false);
    setMessages([]);
    setSearchQuery("");
    setSearchResults([]);
    try {
      const { data } = await api.get(`/messages/${otherUser.id}`);
      setMessages(data);
      // refresh sidebar unread counts
      loadConversations();
    } catch { /* noop */ }
  };

  // ---------- Auto-scroll ----------
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typingFrom]);

  // ---------- Socket subscriptions ----------
  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type === "message") {
        const msg = data.message;
        const isForActive = activeUser && (msg.sender_id === activeUser.id || msg.receiver_id === activeUser.id);
        if (isForActive) {
          setMessages((prev) => {
            // Already present by real id → no-op.
            if (prev.some((m) => m.id === msg.id)) return prev;
            // Replace optimistic temp from the current user if content matches.
            if (msg.sender_id === user.id) {
              const idx = prev.findIndex(
                (m) =>
                  m._pending &&
                  m.text === msg.text &&
                  (m.image_path || null) === (msg.image_path || null) &&
                  (m.audio_path || null) === (msg.audio_path || null),
              );
              if (idx >= 0) {
                const next = prev.slice();
                next[idx] = msg;
                return next;
              }
            }
            return [...prev, msg];
          });
          // We just received a message in the open chat → tell server it's seen.
          // (Server-side GET also emits the 'messages_seen' WS event back to the sender.)
          if (msg.receiver_id === user.id) {
            api.get(`/messages/${activeUser.id}`).catch(() => {});
          }
        }
        loadConversations();
        // In-tab notification when receiving a msg outside the active chat or tab not focused
        if (
          msg.receiver_id === user.id &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          const cur = activeUserRef.current;
          const isAway = document.hidden || !cur || cur.id !== msg.sender_id;
          if (isAway) {
            try {
              const n = new Notification("New message", {
                body: msg.text || "📷 Photo",
                tag: msg.conversation_id,
                silent: false,
              });
              n.onclick = () => { window.focus(); n.close(); };
            } catch { /* noop */ }
          }
        }
      } else if (data.type === "typing") {
        if (activeUser && data.from === activeUser.id) {
          setTypingFrom(data.is_typing ? data.from : null);
          if (data.is_typing) {
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => setTypingFrom(null), 3500);
          }
        }
      } else if (data.type === "messages_seen") {
        if (activeUser && data.seen_by === activeUser.id) {
          setMessages((prev) => prev.map((m) => (m.sender_id === user.id ? { ...m, seen: true } : m)));
        }
      } else if (data.type === "reaction") {
        setMessages((prev) => prev.map((m) => (m.id === data.message_id ? { ...m, reactions: data.reactions } : m)));
      }
    });
    return unsub;
  }, [subscribe, activeUser, user]);

  // ---------- Typing notification ----------
  const onTextChange = (val) => {
    setText(val);
    if (!activeUser) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1200) {
      lastTypingSentRef.current = now;
      wsSend({ type: "typing", to: activeUser.id, is_typing: true });
    }
  };

  // ---------- Send ----------
  const sendMessage = async (override = {}) => {
    const t = (override.text ?? text).trim();
    const image_path = override.image_path || null;
    const audio_path = override.audio_path || null;
    if (!t && !image_path && !audio_path) return;
    if (!activeUser) return;
    if (!override.image_path && !override.audio_path) setText("");
    setShowEmoji(false);
    wsSend({ type: "typing", to: activeUser.id, is_typing: false });
    const reply_to = replyTo?.id || null;
    const replySnapshot = replyTo
      ? {
          id: replyTo.id,
          sender_id: replyTo.sender_id,
          text: (replyTo.text || "").slice(0, 120),
          image_path: replyTo.image_path || null,
          audio_path: replyTo.audio_path || null,
        }
      : null;
    setReplyTo(null);

    // Optimistic: render immediately so there's no perceived delay.
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conv_id = [user.id, activeUser.id].sort().join("::");
    const optimistic = {
      id: tempId,
      conversation_id: conv_id,
      sender_id: user.id,
      receiver_id: activeUser.id,
      text: t,
      image_path,
      audio_path,
      reply_to: replySnapshot,
      reactions: {},
      created_at: new Date().toISOString(),
      seen: false,
      seen_at: null,
      _pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const { data } = await api.post("/messages", {
        receiver_id: activeUser.id, text: t, image_path, audio_path, reply_to,
      });
      // Reconcile: replace temp with real message (or drop temp if WS already added the real one).
      setMessages((prev) => {
        const hasReal = prev.some((m) => m.id === data.id);
        if (hasReal) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? data : m));
      });
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error("Failed to send");
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("Mic not supported"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a mime the browser actually supports. iOS Safari only supports
      // audio/mp4 (AAC) — and crucially can NOT decode audio/webm for playback.
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/aac",
      ];
      const supported =
        (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported)
          ? candidates.find((m) => MediaRecorder.isTypeSupported(m))
          : null;
      const mr = supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const realMime = (mr.mimeType || supported || "audio/webm").split(";")[0];
        const ext = realMime.includes("mp4") || realMime.includes("aac")
          ? "m4a"
          : realMime.includes("ogg")
          ? "ogg"
          : "webm";
        const blob = new Blob(audioChunksRef.current, { type: realMime });
        if (blob.size === 0) return;
        if (blob.size > 5 * 1024 * 1024) { toast.error("Recording too large"); return; }
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append("file", new File([blob], `voice.${ext}`, { type: realMime }));
          const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
          await sendMessage({ text: "", audio_path: data.path });
        } catch { toast.error("Voice upload failed"); }
        finally { setUploading(false); }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
    }
  };

  const stopRecording = () => {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeUser) return;
    if (!file.type.startsWith("image/")) { toast.error("Only image files allowed"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await sendMessage({ text: "", image_path: data.path });
    } catch (err) {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const toggleReaction = async (messageId, emoji) => {
    setReactionTargetId(null);
    try {
      await api.post(`/messages/${messageId}/reactions`, { emoji });
    } catch { toast.error("Reaction failed"); }
  };

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const sidebarList = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((u) => ({
        kind: "user",
        id: u.id,
        username: u.username,
        online: u.online || onlineUsers.has(u.id),
        preview: "Tap to start chatting",
        unread: 0,
      }));
    }
    return conversations.map((c) => ({
      kind: "convo",
      id: c.other_user.id,
      username: c.other_user.username,
      online: c.other_user.online || onlineUsers.has(c.other_user.id),
      preview: c.last_message?.text || "",
      unread: c.unread_count,
      time: c.last_message?.created_at,
    }));
  }, [searchQuery, searchResults, conversations, onlineUsers]);

  const isActiveOnline = activeUser ? onlineUsers.has(activeUser.id) || activeUser.online : false;

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden" data-testid="chat-page">
      {/* Sidebar */}
      <aside
        className={`${showSidebarMobile ? "flex" : "hidden"} md:flex flex-col w-full md:w-96 border-r border-border bg-background`}
        data-testid="chat-sidebar"
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar username={user.username} size={36} />
            <div>
              <div className="font-display font-semibold text-sm" data-testid="sidebar-username">@{user.username}</div>
              <div className="text-[11px] text-muted-foreground">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {user.role === "admin" ? (
              <button
                onClick={() => navigate("/admin")}
                title="Admin"
                data-testid="goto-admin-button"
                className="p-2 rounded-full hover:bg-accent transition-colors"
              >
                <Shield className="w-4 h-4" />
              </button>
            ) : null}
            <button onClick={toggle} title="Theme" data-testid="theme-toggle" className="p-2 rounded-full hover:bg-accent transition-colors">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={onLogout} title="Logout" data-testid="logout-button" className="p-2 rounded-full hover:bg-accent transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="user-search-input"
              placeholder="Search users…"
              className="w-full bg-secondary border border-border rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="sidebar-list">
          {sidebarList.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground px-6 py-12">
              {searchQuery ? "No users found" : "No conversations yet. Search above to start chatting."}
            </div>
          ) : null}
          {sidebarList.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              onClick={() => openChatWith({ id: item.id, username: item.username, online: item.online })}
              data-testid={`chat-row-${item.username}`}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left ${activeUser?.id === item.id ? "bg-accent" : ""}`}
            >
              <Avatar username={item.username} size={48} online={item.online} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold text-sm truncate">{item.username}</span>
                  {item.time ? (
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(item.time)}</span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">{item.preview || " "}</span>
                  {item.unread > 0 ? (
                    <span className="bg-[#0095F6] text-white text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0">
                      {item.unread}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat Panel */}
      <main className={`${showSidebarMobile ? "hidden" : "flex"} md:flex flex-1 flex-col bg-background`}>
        {!activeUser ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-20 h-20 rounded-full border-2 border-foreground flex items-center justify-center mb-6">
              <MessageCircle className="w-10 h-10" strokeWidth={1.5} />
            </div>
            <h2 className="font-display text-2xl font-bold">Your messages</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Search for someone in the sidebar to start a new conversation.
            </p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <button
                onClick={() => setShowSidebarMobile(true)}
                className="md:hidden p-1 rounded-full hover:bg-accent"
                data-testid="back-to-sidebar-button"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Avatar username={activeUser.username} size={40} online={isActiveOnline} />
              <div>
                <div className="font-display font-semibold text-sm" data-testid="active-chat-username">
                  {activeUser.username}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {isActiveOnline ? "Active now" : "Offline"}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6 space-y-2" data-testid="messages-container">
              {messages.map((m, idx) => {
                const isMine = m.sender_id === user.id;
                const prev = messages[idx - 1];
                const showAvatar = !isMine && (!prev || prev.sender_id !== m.sender_id);
                const reactionEntries = Object.entries(m.reactions || {}).filter(([, ids]) => ids?.length);
                return (
                  <div key={m.id} className={`group flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"} msg-in ${m._pending ? "opacity-70" : ""}`}>
                    {!isMine ? (
                      <div className="w-7">{showAvatar ? <Avatar username={activeUser.username} size={28} /> : null}</div>
                    ) : null}
                    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"} max-w-[70%] relative`}>
                      <div className={`flex ${isMine ? "flex-row-reverse" : "flex-row"} items-center gap-1`}>
                        {m.image_path ? (
                          <div data-testid={`message-image-${m.id}`}>
                            <ChatImage path={m.image_path} alt="attachment" onClick={() => setLightboxPath(m.image_path)} />
                          </div>
                        ) : m.audio_path ? (
                          <div data-testid={`message-audio-${m.id}`}>
                            <AudioBubble path={m.audio_path} isMine={isMine} />
                          </div>
                        ) : (
                          <div
                            className={
                              isMine
                                ? "px-4 py-2 rounded-2xl rounded-br-sm bg-gradient-to-br from-blue-500 to-blue-600 text-white text-sm whitespace-pre-wrap break-words shadow-sm"
                                : "px-4 py-2 rounded-2xl rounded-bl-sm bg-secondary text-foreground text-sm whitespace-pre-wrap break-words"
                            }
                            data-testid={`message-${m.id}`}
                          >
                            {m.reply_to ? (
                              <div className={`text-[11px] mb-1 pb-1 border-b ${isMine ? "border-white/30 text-white/80" : "border-border text-muted-foreground"}`}>
                                ↳ {m.reply_to.text || (m.reply_to.image_path ? "📷 Photo" : m.reply_to.audio_path ? "🎤 Voice" : "Message")}
                              </div>
                            ) : null}
                            {m.text}
                          </div>
                        )}
                        <button
                          onClick={() => setReplyTo({ id: m.id, text: m.text, image_path: m.image_path, audio_path: m.audio_path, sender_id: m.sender_id })}
                          data-testid={`reply-button-${m.id}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-accent text-muted-foreground"
                          title="Reply"
                          type="button"
                        >
                          <Reply className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setReactionTargetId(reactionTargetId === m.id ? null : m.id)}
                          data-testid={`react-button-${m.id}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-accent text-muted-foreground"
                          title="React"
                          type="button"
                        >
                          <SmilePlus className="w-4 h-4" />
                        </button>
                      </div>

                      {reactionTargetId === m.id ? (
                        <div
                          className={`absolute z-10 bg-card border border-border rounded-full shadow-lg px-2 py-1 flex items-center gap-1 ${isMine ? "right-0" : "left-0"} -top-9`}
                          data-testid={`reaction-popover-${m.id}`}
                        >
                          {QUICK_REACTIONS.map((e) => (
                            <button
                              key={e}
                              onClick={() => toggleReaction(m.id, e)}
                              className="text-lg hover:scale-125 transition-transform px-1"
                              type="button"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {reactionEntries.length > 0 ? (
                        <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                          {reactionEntries.map(([emoji, ids]) => {
                            const mine = ids.includes(user.id);
                            return (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(m.id, emoji)}
                                data-testid={`reaction-chip-${m.id}-${emoji}`}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${mine ? "border-[#0095F6] bg-[#0095F6]/10" : "border-border bg-secondary hover:bg-accent"}`}
                                type="button"
                              >
                                <span className="mr-1">{emoji}</span>
                                <span className="text-foreground">{ids.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="flex items-center gap-1 mt-1 px-1">
                        <span className="text-[10px] text-muted-foreground">{formatTime(m.created_at)}</span>
                        {isMine ? (
                          m.seen ? (
                            <CheckCheck className="w-3 h-3 text-[#0095F6]" />
                          ) : (
                            <Check className="w-3 h-3 text-muted-foreground" />
                          )
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}

              {typingFrom ? (
                <div className="flex items-end gap-2" data-testid="typing-indicator">
                  <Avatar username={activeUser.username} size={28} />
                  <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-secondary">
                    <div className="flex gap-1">
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Composer */}
            <div className="relative border-t border-border p-3 pb-16 md:pb-3 md:pr-52">
              {replyTo ? (
                <div
                  className="flex items-center justify-between gap-2 mb-2 px-3 py-2 bg-secondary rounded-xl border-l-2 border-[#0095F6]"
                  data-testid="reply-preview"
                >
                  <div className="text-xs min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Replying to</div>
                    <div className="truncate text-foreground">
                      {replyTo.text || (replyTo.image_path ? "📷 Photo" : replyTo.audio_path ? "🎤 Voice message" : "Message")}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    data-testid="reply-cancel-button"
                    className="p-1 rounded-full hover:bg-accent"
                    type="button"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
              {showEmoji ? (
                <div className="absolute bottom-16 left-3 z-50">
                  <EmojiPicker
                    theme={theme === "dark" ? EmojiTheme.DARK : EmojiTheme.LIGHT}
                    onEmojiClick={(d) => setText((t) => t + d.emoji)}
                    width={320}
                    height={360}
                    previewConfig={{ showPreview: false }}
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-2 border border-border rounded-full pl-4 pr-2 py-1.5 bg-secondary">
                <button
                  onClick={() => setShowEmoji((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="emoji-toggle-button"
                  type="button"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  className="hidden"
                  data-testid="image-file-input"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  data-testid="attach-image-button"
                  type="button"
                  disabled={uploading || recording}
                  title="Attach image"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={recording ? stopRecording : startRecording}
                  className={`transition-colors ${recording ? "text-red-500 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={recording ? "stop-recording-button" : "start-recording-button"}
                  type="button"
                  disabled={uploading}
                  title={recording ? "Stop recording" : "Record voice"}
                >
                  {recording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <input
                  value={text}
                  onChange={(e) => onTextChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  data-testid="message-input"
                  placeholder={uploading ? "Uploading…" : "Message…"}
                  className="flex-1 bg-transparent text-sm focus:outline-none py-2"
                />
                {text.trim() ? (
                  <button
                    onClick={() => sendMessage()}
                    data-testid="send-message-button"
                    className="text-[#0095F6] font-semibold text-sm hover:opacity-80 transition-opacity flex items-center gap-1 px-2"
                    type="button"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>
      <Lightbox path={lightboxPath} onClose={() => setLightboxPath(null)} />
    </div>
  );
}
