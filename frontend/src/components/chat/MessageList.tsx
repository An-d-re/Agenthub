"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { DiffCard } from "@/components/cards/DiffCard";
import { PlanCard } from "@/components/cards/PlanCard";
import { PreviewCard } from "@/components/cards/PreviewCard";
import { DAGEditor } from "@/components/plans/DAGEditor";
import { EMPTY_ARRAY } from "@/lib/constants";
import { MessageBubble } from "./MessageBubble";

interface Props {
  onModify?: (messageId: string, startLine: number, endLine: number, instruction: string) => void;
  onPlanAction?: (action: string, taskId?: string, approachName?: string) => boolean;
  onRegenerate?: (messageId: string) => void;
}

export function MessageList({ onModify, onPlanAction, onRegenerate }: Props) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) =>
    activeSessionId ? (s.messages[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );
  const plan = useChatStore((s) =>
    activeSessionId ? s.plans[activeSessionId] : undefined
  );
  const confirmedPlan = useChatStore((s) =>
    activeSessionId ? s.confirmedPlans[activeSessionId] : undefined
  );
  const artifacts = useChatStore((s) =>
    activeSessionId ? (s.artifacts[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );
  const clearConfirmedPlan = useChatStore((s) => s.clearConfirmedPlan);
  const removeDagTask = useChatStore((s) => s.removeDagTask);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, plan, confirmedPlan]);

  const handleSelectApproach = (approach: { name: string }) => {
    onPlanAction?.("select_approach", undefined, approach.name);
  };

  const handleDagConfirm = () => {
    onPlanAction?.("confirm");
    if (activeSessionId) clearConfirmedPlan(activeSessionId);
  };

  const handleDagDelete = (taskId: string) => {
    onPlanAction?.("delete_task", taskId);
    if (activeSessionId) removeDagTask(activeSessionId, taskId);
  };

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        选择一个会话开始聊天
      </div>
    );
  }

  const showPlanCard = plan && plan.approaches.length > 0 && !plan.selectedApproach;
  const showDagEditor = confirmedPlan && confirmedPlan.tasks.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-1">
      {messages.length === 0 && !showDagEditor && (
        <div className="text-center text-muted-foreground mt-8">
          发送消息开始对话
        </div>
      )}
      {messages.map((msg, i) => (
        <MessageBubble key={msg.id || `msg-${msg.createdAt}`} message={msg} index={i} onModify={onModify} onRegenerate={onRegenerate} />
      ))}

      {showPlanCard && (
        <PlanCard
          approaches={plan.approaches}
          onSelect={handleSelectApproach}
        />
      )}

      {showDagEditor && (
        <DAGEditor
          tasks={confirmedPlan.tasks}
          onConfirm={handleDagConfirm}
          onDelete={handleDagDelete}
        />
      )}

      {artifacts.map((a) =>
        ["html", "svg", "css", "javascript", "js"].includes(a.language) ? (
          <PreviewCard key={a.artifactId} artifact={a} />
        ) : (
          <DiffCard key={a.artifactId} artifact={a} />
        )
      )}

      <div ref={bottomRef} />
    </div>
  );
}
