"use client";

import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AgentList } from "@/components/contacts/AgentList";
import { SessionList } from "@/components/contacts/SessionList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TaskPipeline } from "@/components/tasks/TaskPipeline";
import { TracePanel } from "@/components/trace/TracePanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function RightPanel() {
  const [tab, setTab] = useState("tasks");

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full">
      <TabsList className="w-full rounded-none border-b border-border/50 bg-transparent h-auto p-0">
        <TabsTrigger
          value="tasks"
          className="flex-1 text-[11px] tracking-wide rounded-none data-[state=active]:border-b-2 data-[state=active]:border-orange-500 data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground h-9 transition-colors"
        >
          任务
        </TabsTrigger>
        <TabsTrigger
          value="traces"
          className="flex-1 text-[11px] tracking-wide rounded-none data-[state=active]:border-b-2 data-[state=active]:border-orange-500 data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground h-9 transition-colors"
        >
          追踪
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="flex-1 overflow-hidden mt-0">
        <TaskPipeline />
      </TabsContent>
      <TabsContent value="traces" className="flex-1 overflow-hidden mt-0">
        <TracePanel />
      </TabsContent>
    </Tabs>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background relative z-10">
      {/* 顶部品牌栏 */}
      <header className="h-11 border-b border-border/50 flex items-center px-5 shrink-0">
        <span className="text-sm font-semibold tracking-tight">
          <span className="text-foreground">Agent</span>
          <span className="text-orange-500">Hub</span>
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground tracking-wide uppercase">
          Multi-Agent Collaboration
        </span>
      </header>

      {/* 主区域 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧栏：联系人 + 会话 */}
        <div className="w-64 border-r border-border/50 flex flex-col h-full shrink-0">
          <ErrorBoundary>
            <AgentList />
            <div className="border-t border-border/30 mx-3" />
            <SessionList />
          </ErrorBoundary>
        </div>

        {/* 中央聊天区 */}
        <ErrorBoundary>
          <ChatPanel />
        </ErrorBoundary>

        {/* 右侧面板：任务/追踪 */}
        <div className="w-64 border-l border-border/50 shrink-0">
          <ErrorBoundary>
            <RightPanel />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
