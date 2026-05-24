"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import { DiffCard } from "@/components/cards/DiffCard";
import { PlanCard } from "@/components/cards/PlanCard";
import { EMPTY_ARRAY } from "@/lib/constants";
import { MessageBubble } from "./MessageBubble";

export function MessageList() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) =>
    activeSessionId ? (s.messages[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );
  const plan = useChatStore((s) =>
    activeSessionId ? s.plans[activeSessionId] : undefined
  );
  const artifacts = useChatStore((s) =>
    activeSessionId ? (s.artifacts[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, plan]);

  const handleSelectApproach = (approach: { name: string }) => {
    useChatStore.getState().setPendingSend(approach.name);
  };

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        选择一个会话开始聊天
      </div>
    );
  }

  const showPlanCard = plan && plan.approaches.length > 0 && !plan.selectedApproach;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-1">
      {messages.length === 0 && (
        <div className="text-center text-muted-foreground mt-8">
          发送消息开始对话
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id || `msg-${msg.createdAt}`} message={msg} />
      ))}

      {showPlanCard && (
        <PlanCard
          approaches={plan.approaches}
          onSelect={handleSelectApproach}
        />
      )}

      {artifacts.map((a) => (
        <DiffCard key={a.artifactId} artifact={a} />
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
