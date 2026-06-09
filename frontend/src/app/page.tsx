"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LeftSidebar } from "@/components/contacts/LeftSidebar";
import { Cover } from "@/components/Cover";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CollaborationStage } from "@/components/tasks/CollaborationStage";
import { TracePanel } from "@/components/trace/TracePanel";
import { useTheme } from "@/hooks/useTheme";
import { useContacts } from "@/hooks/useContacts";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

function RightPanel() {
  const [tab, setTab] = useState<"tasks"|"traces">("tasks");
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div className="flex px-4 pt-4 pb-0 gap-1">
        <button onClick={()=>setTab("tasks")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="tasks"?"bg-[var(--accent)] text-white":"text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:text-[var(--bg-secondary)]"}`}>协作</button>
        <button onClick={()=>setTab("traces")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="traces"?"bg-[var(--accent)] text-white":"text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:text-[var(--bg-secondary)]"}`}>追踪</button>
      </div>
      <div className="flex-1 overflow-hidden mt-3">
        {tab === "tasks" ? <CollaborationStage /> : <TracePanel />}
      </div>
    </div>
  );
}

export default function Home() {
  const { dark, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showCover, setShowCover] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("agenthub_cover_dismissed")) {
      setShowCover(true);
    }
    setHydrated(true);
  }, []);

  // First-visit Demo
  useEffect(() => {
    const created = localStorage.getItem("agenthub_demo_created");
    if (created) return;

    const interval = setInterval(async () => {
      const agents = useAgentStore.getState().agents;
      if (agents.length < 2) return;
      clearInterval(interval);

      try {
        const r = await fetch(`${API_BASE}/api/sessions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Demo 演示", type: "group", agent_ids: agents.slice(0, 3).map(a => a.id) }),
        });
        if (r.ok) {
          const s = await r.json();
          const store = useChatStore.getState();
          store.setSessions([s, ...store.sessions]);
          store.setActiveSession(s.id);
        }
      } catch {} finally {
        localStorage.setItem("agenthub_demo_created", "1");
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const { sessions, activeSessionId, setActiveSession } = useContacts();

  // 从 URL 恢复上次打开的会话（仅在会话列表加载后执行一次）
  const [urlRestored, setUrlRestored] = useState(false);

  useEffect(() => {
    if (urlRestored || sessions.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (sid && sessions.some((s) => s.id === sid)) {
      setActiveSession(sid);
    }
    setUrlRestored(true);
  }, [sessions.length, urlRestored, setActiveSession]);

  // 活跃会话切换时同步到 URL
  useEffect(() => {
    if (!activeSessionId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("session") === activeSessionId) return;
    url.searchParams.set("session", activeSessionId);
    window.history.replaceState({}, "", url.toString());
  }, [activeSessionId]);

  // hydration 完成前不渲染，避免 SSR/客户端 DOM 不匹配
  if (!hydrated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)]">
      {showCover && (
        <Cover onDismiss={() => {
          sessionStorage.setItem("agenthub_cover_dismissed", "1");
          setShowCover(false);
        }} />
      )}
      {/* Sidebar — always on md+, togglable on mobile */}
      <div className={cn(
        "w-[240px] shrink-0 border-r border-[var(--border)] flex flex-col transition-transform duration-200",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl",
        !sidebarOpen && "max-md:-translate-x-full",
      )}>
        <LeftSidebar />
      </div>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <ChatPanel />
      {/* Mobile sidebar toggle button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed top-3 left-3 z-50 w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border)] shadow-md flex items-center justify-center text-[var(--text-secondary)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="w-[340px] shrink-0 border-l border-[var(--border)] hidden xl:flex flex-col bg-[var(--bg-primary)]">
        <RightPanel />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 w-10 h-10 rounded-full bg-[var(--bg-primary)] border border-[var(--border)] shadow-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all z-50"
        title={dark ? "切换到浅色模式" : "切换到暗色模式"}
      >
        {dark ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </div>
  );
}
