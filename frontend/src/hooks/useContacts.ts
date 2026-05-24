"use client";

import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useContacts() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (res.ok) {
        const data = await res.json();
        useChatStore.getState().setSessions(data);
        if (!useChatStore.getState().activeSessionId && data.length > 0) {
          useChatStore.getState().setActiveSession(data[0].id);
        }
      }
    } catch {
      // server not ready yet
    }
  };

  const createSession = async (title: string, type: string = "single") => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type, agent_ids: [] }),
      });
      if (res.ok) {
        const session = await res.json();
        const prev = useChatStore.getState().sessions;
        useChatStore.getState().setSessions([session, ...prev]);
        useChatStore.getState().setActiveSession(session.id);
        return session;
      }
    } catch {
      // ignore
    }
    return null;
  };

  useEffect(() => {
    fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { sessions, activeSessionId, setActiveSession, createSession, refresh: fetchSessions };
}
