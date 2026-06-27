import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { wsUrl } from "../lib/api";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const listenersRef = useRef(new Set());

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const send = useCallback((payload) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    let retry = 0;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };

      ws.onmessage = (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        if (data.type === "presence") {
          setOnlineUsers((prev) => {
            const next = new Set(prev);
            if (data.online) next.add(data.user_id);
            else next.delete(data.user_id);
            return next;
          });
        }
        listenersRef.current.forEach((fn) => fn(data));
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          retry = Math.min(retry + 1, 5);
          setTimeout(connect, 1000 * retry);
        }
      };
      ws.onerror = () => { ws.close(); };
    }

    connect();
    return () => {
      cancelled = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, user]);

  return (
    <SocketContext.Provider value={{ connected, send, subscribe, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be inside SocketProvider");
  return ctx;
}
