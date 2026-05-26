"use client";

import { useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; dot: string; bar: string }> = {
  done: { label: "完成", dot: "bg-[#34C759]", bar: "bg-[#34C759]" },
  running: { label: "执行中", dot: "bg-[#007AFF] animate-pulse-blue", bar: "bg-[#007AFF]" },
  reviewing: { label: "审查中", dot: "bg-[#FF9F0A] animate-pulse", bar: "bg-[#FF9F0A]" },
  retrying: { label: "重试", dot: "bg-[#FF9F0A]", bar: "bg-[#FF9F0A]" },
  failed: { label: "失败", dot: "bg-[#FF3B30]", bar: "bg-[#FF3B30]" },
  blocked: { label: "已阻止", dot: "bg-[#FF3B30]", bar: "bg-[#FF3B30]" },
  dispute: { label: "争议", dot: "bg-[#FF3B30]", bar: "bg-[#FF3B30]" },
  cancelled: { label: "已取消", dot: "bg-[#C7C7CC]", bar: "bg-[#C7C7CC]" },
  pending: { label: "等待中", dot: "bg-[#C7C7CC]", bar: "bg-[#C7C7CC]" },
};

function latencyStr(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TaskPipeline() {
  const sid = useChatStore((s) => s.activeSessionId);
  const tasks = useChatStore((s) => (sid ? s.tasks[sid] || EMPTY_ARRAY : EMPTY_ARRAY));
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!sid) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-[var(--text-tertiary)]">
        选择会话查看任务
      </div>
    );
  }

  if (connectionStatus === "connecting") {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#1C1C1E] px-4 py-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-2 w-full rounded-full" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <Skeleton className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-[var(--text-tertiary)]">
        暂无活跃任务
      </div>
    );
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="flex flex-col h-full animate-fade-in bg-white dark:bg-[#1C1C1E]">
      {/* Header + Progress */}
      <div className="shrink-0 px-4 py-4 border-b border-[var(--border)] dark:border-[#38383A]/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">
            Pipeline
          </h3>
          <span className="text-[12px] text-[var(--text-secondary)] tabular-nums">
            {doneCount}/{tasks.length}
          </span>
        </div>
        {/* Segmented progress bar */}
        <div className="flex gap-1 h-1.5">
          {tasks.map((t) => {
            const c = STATUS[t.status] || STATUS.pending;
            return (
              <div
                key={t.taskId}
                className={cn("flex-1 rounded-full transition-all duration-500", c.bar)}
                title={`${t.title}: ${c.label}`}
              />
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
          {Array.from(new Set(tasks.map((t) => t.status))).map((s) => {
            const c = STATUS[s] || STATUS.pending;
            return (
              <div key={s} className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", c.dot)} />
                <span className="text-[11px] text-[var(--text-secondary)]">{c.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline cards */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {tasks.map((t, i) => {
          const c = STATUS[t.status] || STATUS.pending;
          const isOpen = expanded[t.taskId];
          const agentName = agents.find((a) => a.id === t.agentId)?.name || t.agentId?.slice(0, 8) || "";
          const latency = latencyStr(t.startedAt, t.completedAt);

          return (
            <div key={t.taskId} className="relative">
              {/* Connector line */}
              {i < tasks.length - 1 && (
                <div className="absolute left-[15px] top-10 bottom-0 w-[2px] bg-[var(--border)] dark:bg-[#48484A]" />
              )}

              {/* Card */}
              <div className="relative ml-1 mb-1">
                <button
                  onClick={() => toggle(t.taskId)}
                  className={cn(
                    "w-full text-left pl-7 pr-3 py-2.5 rounded-[12px] transition-all duration-150",
                    "hover:bg-[var(--bg-secondary)] dark:hover:bg-[#3A3A3C]",
                    t.status === "running" && "bg-[#007AFF]/5 dark:bg-[#007AFF]/10",
                  )}
                >
                  {/* Status dot */}
                  <div className={cn("absolute left-2 top-3.5 w-2.5 h-2.5 rounded-full z-10", c.dot)} />

                  {/* Title row */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[14px] font-medium truncate flex-1",
                        t.status === "done"
                          ? "text-[var(--text-secondary)] line-through"
                          : "text-[var(--text-primary)] dark:text-[var(--bg-secondary)]",
                      )}
                    >
                      {t.title}
                    </span>
                    {/* Expand chevron */}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={cn(
                        "text-[var(--text-tertiary)] transition-transform shrink-0",
                        isOpen && "rotate-180",
                      )}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {/* Compact info row */}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] font-medium" style={{ color: c.bar === "bg-[#C7C7CC]" ? "#8E8E93" : undefined }}>
                      {c.label}
                    </span>
                    {agentName && (
                      <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
                        {agentName}
                      </span>
                    )}
                    {latency && (
                      <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {latency}
                      </span>
                    )}
                    {(t.retryCount ?? 0) > 0 && (
                      <span className="text-[11px] text-[#FF9F0A] flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M4 15a9 9 0 1 0 3-9.7"/></svg>
                        {t.retryCount}x
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="ml-7 mr-3 mb-2 px-4 py-3 rounded-[12px] bg-[var(--bg-secondary)] dark:bg-[#2C2C2E] animate-fade-in space-y-2">
                    {t.description && (
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase mb-1">描述</div>
                        <div className="text-[13px] text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">{t.description}</div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4">
                      {agentName && (
                        <div>
                          <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">Agent</div>
                          <div className="text-[13px] text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">{agentName}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">状态</div>
                        <div className="text-[13px] font-medium" style={{ color: c.bar === "bg-[#C7C7CC]" ? "#8E8E93" : undefined }}>{c.label}</div>
                      </div>
                      {latency && (
                        <div>
                          <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">耗时</div>
                          <div className="text-[13px] text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">{latency}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase">重试</div>
                        <div className="text-[13px] text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">{t.retryCount ?? 0} 次</div>
                      </div>
                    </div>
                    {t.error && (
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase mb-1">错误信息</div>
                        <div className="text-[12px] text-[var(--danger)] bg-red-50 dark:bg-red-50/10 rounded-[8px] px-3 py-2 font-mono">{t.error}</div>
                      </div>
                    )}
                    {t.result && (
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase mb-1">输出</div>
                        <div className="text-[12px] text-[var(--text-primary)] dark:text-[var(--bg-secondary)] bg-white dark:bg-[#3A3A3C] rounded-[8px] px-3 py-2 font-mono max-h-[200px] overflow-y-auto whitespace-pre-wrap">{t.result.slice(0, 1000)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
