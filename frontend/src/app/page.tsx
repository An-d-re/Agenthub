"use client";

import { useState } from "react";
import { LeftSidebar } from "@/components/contacts/LeftSidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TaskPipeline } from "@/components/tasks/TaskPipeline";
import { TracePanel } from "@/components/trace/TracePanel";

function RightPanel() {
  const [tab, setTab] = useState<"tasks"|"traces">("tasks");
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex px-4 pt-4 pb-0 gap-1">
        <button onClick={()=>setTab("tasks")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="tasks"?"bg-[#007AFF] text-white":"text-[#86868B] hover:text-[#1D1D1F]"}`}>任务</button>
        <button onClick={()=>setTab("traces")} className={`px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${tab==="traces"?"bg-[#007AFF] text-white":"text-[#86868B] hover:text-[#1D1D1F]"}`}>追踪</button>
      </div>
      <div className="flex-1 overflow-hidden mt-3">
        {tab === "tasks" ? <TaskPipeline /> : <TracePanel />}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <div className="w-[240px] shrink-0 border-r border-[#E5E5E7] hidden md:flex flex-col">
        <LeftSidebar />
      </div>
      <ChatPanel />
      <div className="w-[340px] shrink-0 border-l border-[#E5E5E7] hidden xl:flex flex-col bg-white">
        <RightPanel />
      </div>
    </div>
  );
}
