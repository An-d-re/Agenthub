"use client";

import { useCallback, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

export function useContacts() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          useChatStore.getState().setSessions(data);
          if (!useChatStore.getState().activeSessionId && data.length > 0) {
            useChatStore.getState().setActiveSession(data[0].id);
          }
        }
      }
    } catch (e) {
      console.error("获取会话列表失败:", e);
    }
  }, []);

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
    } catch (e) {
      console.error("创建会话失败:", e);
    }
    return null;
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return { sessions, activeSessionId, setActiveSession, createSession, refresh: fetchSessions };
}
