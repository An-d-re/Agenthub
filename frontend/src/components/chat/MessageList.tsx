"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { MessageBubble } from "./MessageBubble";
import { PlanCard } from "@/components/cards/PlanCard";
import { DAGEditor } from "@/components/plans/DAGEditor";
import { EMPTY_ARRAY, API_BASE } from "@/lib/constants";

interface Props {
  onModify?: (messageId: string, startLine: number, endLine: number, instruction: string) => void;
  onPlanAction?: (action: string, taskId?: string, approachName?: string, assignments?: Record<string, unknown>[]) => boolean;
  onRegenerate?: (messageId: string) => void;
  searchTerm?: string;
}

export function MessageList({ onModify, onPlanAction, onRegenerate, searchTerm }: Props) {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const messages = useChatStore((s) =>
    activeSessionId ? (s.messages[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const plan = useChatStore((s) =>
    activeSessionId ? s.plans[activeSessionId] : undefined
  );
  const confirmedPlan = useChatStore((s) =>
    activeSessionId ? s.confirmedPlans[activeSessionId] : undefined
  );
  const clearConfirmedPlan = useChatStore((s) => s.clearConfirmedPlan);
  const removeDagTask = useChatStore((s) => s.removeDagTask);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  // 追踪用户是否手动上滚
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 150; // 距底部 150px 内视为"在底部"
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > threshold;
  };

  useEffect(() => {
    if (!activeSessionId) return;
    setMsgLoading(true);
    setMsgError(false);
    fetch(`${API_BASE}/api/sessions/${activeSessionId}/messages?limit=50`)
      .then(r => { if (!r.ok) throw new Error("fail"); return r.json(); })
      .then(data => {
        if (!Array.isArray(data)) return;
        const store = useChatStore.getState();
        const existing = store.messages[activeSessionId] || [];
        const existingIds = new Set(existing.map(m => m.id));
        const apiMessages = data.map((m: Record<string,unknown>) => ({
          id: m.id as string, sessionId: m.session_id as string,
          agentId: m.agent_id as string, agentRole: m.agent_role as string,
          role: m.role as "user" | "agent" | "system", content: m.content as string,
          messageType: m.message_type as string, parentId: m.parent_id as string,
          fileName: m.file_name as string, fileUrl: m.file_url as string,
          fileSize: m.file_size as number, fileLanguage: m.file_language as string,
          createdAt: m.created_at as string,
        }));
        // 合并：保留 WebSocket 已推送的新消息（API 可能还没包含），去重
        const wsOnly = existing.filter(m => !existingIds.has(m.id) || m.id.startsWith("local-"));
        const merged = [...apiMessages, ...wsOnly.filter(m => !apiMessages.some(a => a.id === m.id))];
        store.setMessages(activeSessionId, merged);
      }).catch(() => setMsgError(true)).finally(() => setMsgLoading(false));
  }, [activeSessionId]);

  useEffect(() => {
    // 用户已上滚查看历史时不强制滚到底部
    if (userScrolledUpRef.current) return;
    // 流式接收时用 instant（避免抖动），消息稳定后用 smooth
    const last = messages[messages.length - 1];
    const isStreaming = last?.role === "agent" && (!last.content || last.reasoning !== undefined);
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "instant" : "smooth" });
  }, [messages, plan, confirmedPlan]);

  const handleSelectApproach = (approach: { name: string }) => {
    onPlanAction?.("select_approach", undefined, approach.name);
  };

  const handleDagConfirm = (assignments: Record<string, unknown>[]) => {
    onPlanAction?.("confirm", undefined, undefined, assignments);
    if (activeSessionId) clearConfirmedPlan(activeSessionId);
  };

  const handleDagDelete = (taskId: string) => {
    onPlanAction?.("delete_task", taskId);
    if (activeSessionId) removeDagTask(activeSessionId, taskId);
  };

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
        <div className="text-[64px] leading-none opacity-20">#</div>
        <div className="text-[15px] font-medium">从左侧选择一个 Agent 或群聊开始</div>
        <div className="text-[12px] text-[var(--text-tertiary)]/70">试试直接说出你想做什么，比如「帮我写一个网页倒计时」</div>
      </div>
    );
  }

  const showPlanCard = plan && plan.approaches.length > 0 && !plan.selectedApproach;
  const showDagEditor = confirmedPlan && confirmedPlan.tasks.length > 0;

  // 最后一条是用户消息 → 显示等待 Agent 回复的思考动画
  const lastMsg = messages[messages.length - 1];
  const isThinking = lastMsg?.role === "user" && !showPlanCard && !showDagEditor;

  // 过滤：卡片出现时隐藏临时进度提示
  const displayMessages = (searchTerm
    ? messages.filter(m => m.content.toLowerCase().includes(searchTerm.toLowerCase()))
    : messages
  ).filter(m => {
    if (m.messageType === "temp_progress" && (showPlanCard || showDagEditor)) return false;
    return true;
  });

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-1">
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
        <div className="text-center mt-12 px-8">
          <div className="text-[64px] leading-none mb-4 opacity-15">{activeSession?.type === "group" ? "#" : "@"}</div>
          <div className="text-[15px] font-medium text-[var(--text-secondary)] mb-5">
            {activeSession?.type === "group" ? "描述你的需求，Orchestrator 会协调多位 Agent 协作" : "直接告诉 Agent 你想做什么"}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              "帮我做一个番茄钟网页",
              "写一个 Python 爬虫抓取天气数据",
              "解释一下 Transformer 注意力机制",
              "帮我分析这份数据的趋势",
            ].map(example => (
              <button
                key={example}
                onClick={() => {
                  const inputEl = document.querySelector<HTMLTextAreaElement>("textarea[placeholder*='输入消息']");
                  if (inputEl) {
                    // 触发展开 MessageInput 中的 @ mention 或直接设置文本
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                    nativeInputValueSetter?.call(inputEl, example);
                    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
                    inputEl.focus();
                  }
                }}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)] transition-all"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
      {displayMessages.map((msg, i) => (
        <MessageBubble key={msg.id || `msg-${msg.createdAt}`} message={msg} index={i} onModify={onModify} onRegenerate={onRegenerate} />
      ))}
      {searchTerm && displayMessages.length === 0 && messages.length > 0 && (
        <div className="text-center text-[var(--text-secondary)] mt-6 text-[13px]">无匹配消息</div>
      )}

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

      {/* Thinking indicator */}
      {isThinking && (
        <div className="flex px-6 gap-3 mb-1.5">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] flex items-center justify-center shrink-0 mt-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16c0-2 4-4 8-4s4 2 4 4"/></svg>
          </div>
          <div className="bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] rounded-2xl rounded-bl-[4px] px-4 py-3">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)] animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)] animate-pulse" style={{ animationDelay: "200ms" }} />
              <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)] animate-pulse" style={{ animationDelay: "400ms" }} />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
