"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { DiffCard } from "@/components/cards/DiffCard";
import { PlanCard } from "@/components/cards/PlanCard";
import { PreviewCard } from "@/components/cards/PreviewCard";
import { DAGEditor } from "@/components/plans/DAGEditor";
import { EMPTY_ARRAY, API_BASE } from "@/lib/constants";
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
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeSessionId) return;
    setMsgLoading(true);
    setMsgError(false);
    fetch(`${API_BASE}/api/sessions/${activeSessionId}/messages?limit=50`)
      .then(r => { if (!r.ok) throw new Error("fail"); return r.json(); })
      .then(data => {
        const store = useChatStore.getState();
        const existing = store.messages[activeSessionId] || [];
        if (existing.length === 0 && Array.isArray(data)) {
          store.setMessages(activeSessionId, data.reverse().map((m: Record<string,unknown>) => ({
            id: m.id as string, sessionId: m.session_id as string,
            agentId: m.agent_id as string, agentRole: m.agent_role as string,
            role: m.role as "user" | "agent" | "system", content: m.content as string,
            messageType: m.message_type as string, parentId: m.parent_id as string,
            fileName: m.file_name as string, fileUrl: m.file_url as string,
            fileSize: m.file_size as number, createdAt: m.created_at as string,
          })));
        }
      }).catch(() => setMsgError(true)).finally(() => setMsgLoading(false));
  }, [activeSessionId]);

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
      {/* Error state */}
      {msgError && !msgLoading && (
        <div className="text-center mt-12">
          <div className="text-[var(--text-tertiary)] text-sm mb-3">加载消息失败</div>
          <button onClick={() => { setMsgError(false); setMsgLoading(true); fetch(`${API_BASE}/api/sessions/${activeSessionId}/messages?limit=50`).then(() => setMsgLoading(false)).catch(() => setMsgError(true)); }}
            className="text-[12px] text-[var(--accent)] hover:underline">重试</button>
        </div>
      )}

      {/* Loading skeleton */}
      {msgLoading && messages.length === 0 && (
        <div className="space-y-3 px-6 pt-4">
          {[1,2,3].map(i => (
            <div key={i} className={`flex gap-3 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-[var(--bg-secondary)] animate-pulse shrink-0" />
              <div className={`rounded-2xl px-4 py-3 bg-[var(--bg-secondary)] animate-pulse ${i % 2 === 0 ? 'max-w-[60%]' : 'max-w-[70%]'}`}>
                <div className="h-3 w-20 bg-[var(--border)] rounded mb-2" />
                <div className="h-3 w-40 bg-[var(--border)] rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!msgLoading && messages.length === 0 && !showDagEditor && !msgError && (
        <div className="text-center text-[var(--text-tertiary)] mt-12">
          <div className="text-4xl mb-3">💬</div>
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
