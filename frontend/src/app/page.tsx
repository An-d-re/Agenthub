"use client";

import { useState } from "react";
import { AgentList } from "@/components/contacts/AgentList";
import { SessionList } from "@/components/contacts/SessionList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TaskPipeline } from "@/components/tasks/TaskPipeline";
import { TracePanel } from "@/components/trace/TracePanel";

type RightTab = "tasks" | "traces";

function RightPanel() {
  const [tab, setTab] = useState<RightTab>("tasks");

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab("tasks")}
          className={`flex-1 text-[10px] uppercase tracking-wider py-2 transition-colors ${
            tab === "tasks"
              ? "text-zinc-100 border-b border-green-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          任务
        </button>
        <button
          onClick={() => setTab("traces")}
          className={`flex-1 text-[10px] uppercase tracking-wider py-2 transition-colors ${
            tab === "traces"
              ? "text-zinc-100 border-b border-green-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          追踪
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "tasks" ? <TaskPipeline /> : <TracePanel />}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex h-screen w-screen overflow-hidden relative z-10">
      <div className="w-72 border-r border-zinc-800 flex flex-col h-full shrink-0">
        <AgentList />
        <div className="border-t border-zinc-800" />
        <SessionList />
      </div>
      <ChatPanel />
      <div className="w-72 border-l border-zinc-800 shrink-0">
        <RightPanel />
      </div>
    </div>
  );
}
