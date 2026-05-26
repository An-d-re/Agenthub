"use client";

import { useEffect, useState } from "react";
import { LeftSidebar } from "@/components/contacts/LeftSidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TaskPipeline } from "@/components/tasks/TaskPipeline";
import { TracePanel } from "@/components/trace/TracePanel";
import { useTheme } from "@/hooks/useTheme";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

function RightPanel() {
  const [tab, setTab] = useState<"tasks"|"traces">("tasks");
  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1C1C1E]">
      <div className="flex px-4 pt-4 pb-0 gap-1">
        <button onClick={()=>setTab("tasks")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="tasks"?"bg-[var(--accent)] text-white":"text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:text-[#98989D] dark:hover:text-[var(--bg-secondary)]"}`}>任务</button>
        <button onClick={()=>setTab("traces")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="traces"?"bg-[var(--accent)] text-white":"text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:text-[#98989D] dark:hover:text-[var(--bg-secondary)]"}`}>追踪</button>
      </div>
      <div className="flex-1 overflow-hidden mt-3">
        {tab === "tasks" ? <TaskPipeline /> : <TracePanel />}
      </div>
    </div>
  );
}

export default function Home() {
  const { dark, toggle } = useTheme();

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-[#1C1C1E]">
      <div className="w-[240px] shrink-0 border-r border-[var(--border)] dark:border-[#38383A] hidden md:flex flex-col">
        <LeftSidebar />
      </div>
      <ChatPanel />
      <div className="w-[340px] shrink-0 border-l border-[var(--border)] dark:border-[#38383A] hidden xl:flex flex-col bg-white dark:bg-[#1C1C1E]">
        <RightPanel />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed bottom-4 right-4 w-10 h-10 rounded-full bg-white dark:bg-[var(--bg-secondary)] border border-[var(--border)] dark:border-[#38383A] shadow-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:hover:text-[var(--bg-secondary)] transition-all z-50"
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
