"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LeftSidebar } from "@/components/contacts/LeftSidebar";
import { Cover } from "@/components/Cover";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CollaborationStage } from "@/components/tasks/CollaborationStage";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useTheme } from "@/hooks/useTheme";
import { useContacts } from "@/hooks/useContacts";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE, EMPTY_ARRAY } from "@/lib/constants";

function RightPanelHeader() {
  const sid = useChatStore(s => s.activeSessionId);
  const tasks = useChatStore(s => sid ? (s.tasks[sid] || EMPTY_ARRAY) : EMPTY_ARRAY);
  const confirmedPlan = useChatStore(s => sid ? s.confirmedPlans[sid] : undefined);
  const total = confirmedPlan?.tasks?.length || tasks.length;
  const done = tasks.filter(t => t.status === "done").length;
  return (
    <div className="shrink-0 h-[56px] flex items-center justify-between px-4 border-b border-[var(--border)]">
      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">协作剧场</h3>
      {total > 0 && (
        <span className="text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">{done}/{total}</span>
      )}
    </div>
  );
}

function RightPanel() {
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <RightPanelHeader />
      <div className="flex-1 overflow-hidden">
        <CollaborationStage />
      </div>
    </div>
  );
}

export default function Home() {
  const { dark, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showCover, setShowCover] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  // 切换会话时从后端加载已有任务计划（刷新页面也能恢复协作剧场）
  useEffect(() => {
    if (!activeSessionId) return;
    const store = useChatStore.getState();
    // 已经有 plan 的跳过（WebSocket 会实时更新）
    if (store.confirmedPlans[activeSessionId]) return;
    fetch(`${API_BASE}/api/sessions/${activeSessionId}/plan`)
      .then(r => r.json())
      .then(data => {
        // /plan 端点直接返回 { phase, tasks: DAGTask[], hint }，tasks 已含 id/db_id/dependencies/status
        const apiTasks = data?.tasks;
        if (apiTasks?.length > 0) {
          const dagTasks = apiTasks.map((td: Record<string, unknown>) => ({
            id: (td.id || "") as string,
            db_id: (td.db_id || td.id || "") as string,
            title: (td.title || "") as string,
            description: (td.description || "") as string,
            dependencies: (td.dependencies || []) as string[],
            required_capability: (td.required_capability || "code") as string,
            executor_type: (td.executor_type || "existing") as "existing" | "new",
            agent_id: (td.assigned_agent_id || td.agent_id || null) as string | null,
            agent_name: (td.agent_name || null) as string | null,
            match_reason: (td.match_reason || "") as string,
          }));
          store.setConfirmedPlan(activeSessionId, { tasks: dagTasks, hint: data.hint || "" });

          // 同时把运行时状态写入 tasks store，让协作剧场在 WS 重连前就能展示最新状态
          store.setTasks(activeSessionId, apiTasks.map((t: Record<string, unknown>) => ({
            taskId: (t.db_id || t.id || "") as string,
            title: (t.title || "") as string,
            description: (t.description || "") as string,
            status: (t.status || "pending") as "pending" | "running" | "reviewing" | "done" | "blocked" | "retrying" | "failed" | "dispute" | "cancelled",
            result: t.result_preview as string | undefined,
            error: t.error_message as string | undefined,
            retryCount: (t.retry_count || 0) as number,
            agentId: (t.assigned_agent_id || "") as string,
            startedAt: t.started_at as string | undefined,
            completedAt: t.completed_at as string | undefined,
          })));
        }
      })
      .catch(() => {});
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
        <LeftSidebar onOpenSettings={() => setShowSettings(true)} />
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

      {/* Top-right controls — z-40 so Settings/AgentEditor panels (z-50) cover them */}
      <div className="fixed top-1.5 right-12 z-40 flex items-center gap-2">
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-[var(--bg-primary)]/80 backdrop-blur border border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
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
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
