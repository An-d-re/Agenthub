"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { AgentIcon } from "@/lib/agentIcons";

const ADAPTER_COLORS: Record<string, string> = {
  deepseek: "#a855f7", anthropic: "#f59e0b", opencode: "#3b82f6", codex: "#06b6d4",
};

const ROLE_NL: Record<string, string> = {
  pending: "待开始", running: "执行中", reviewing: "审查中", done: "完成",
  failed: "失败", blocked: "阻塞", retrying: "重试", dispute: "退回", cancelled: "取消",
};

// ── 任务行 ──

function TaskRow({
  task, agent, isLast,
}: {
  task: { taskId: string; title: string; status: string; agentId?: string };
  agent?: { id: string; name: string; adapterType: string };
  isLast: boolean;
}) {
  const isDone = task.status === "done";
  const isRunning = task.status === "running" || task.status === "reviewing";
  const isFailed = task.status === "failed" || task.status === "blocked" || task.status === "dispute";
  const isPending = task.status === "pending";
  const agentColor = agent ? ADAPTER_COLORS[agent.adapterType] || "#6b7280" : "#6b7280";

  return (
    <div className="flex" style={{ minHeight: isLast ? 52 : 64 }}>
      {/* Left: timeline rail */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 32 }}>
        {/* Avatar dot */}
        <div className="relative">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-500"
            style={{
              background: isPending
                ? "var(--bg-tertiary)"
                : isDone
                  ? "var(--success)"
                  : isFailed
                    ? "var(--danger)"
                    : `linear-gradient(135deg, ${agentColor}, ${agentColor}dd)`,
              opacity: isPending ? 0.4 : 1,
            }}
          >
            {isDone ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : agent ? (
              <AgentIcon adapterType={agent.adapterType} size={13} />
            ) : (
              <span className="text-[8px] font-bold text-white">?</span>
            )}
          </div>
          {/* Running pulse */}
          {isRunning && (
            <motion.div
              className="absolute inset-0 rounded-full ring-2 ring-[var(--accent)]/25"
              animate={{ scale: [1, 1.45, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
        {/* Timeline connector */}
        {!isLast && (
          <div className="flex-1 flex justify-center">
            <motion.div
              className="w-px"
              style={{ background: isDone ? "var(--success)/0.15" : "var(--border)" }}
              animate={isRunning ? { opacity: [0.3, 0.6, 0.3] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
        )}
      </div>

      {/* Right: content */}
      <div
        className="flex-1 ml-3 rounded-xl transition-all duration-500 flex items-center"
        style={{
          background: isRunning
            ? "var(--accent)/0.05"
            : isDone
              ? "var(--success)/0.04"
              : "transparent",
          border: isRunning ? "1px solid var(--accent)/0.12" :
                  isDone ? "1px solid transparent" :
                  "1px solid transparent",
          padding: "6px 12px 6px 0",
          marginBottom: isLast ? 0 : 4,
        }}
      >
        <div className="min-w-0 flex-1">
          {/* Task title */}
          <div
            className="text-[12px] font-semibold leading-tight transition-colors duration-500"
            style={{
              color: isDone ? "var(--success)" :
                     isRunning ? "var(--accent)" :
                     isFailed ? "var(--danger)" :
                     "var(--text-primary)",
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {task.title}
          </div>
          {/* Agent name + status */}
          <div className="flex items-center gap-2 mt-0.5">
            {agent ? (
              <span className="text-[10px] font-medium text-[var(--text-secondary)] truncate max-w-[100px]">
                {agent.name}
              </span>
            ) : (
              <span className="text-[10px] text-[var(--text-tertiary)]">未分配</span>
            )}
            <span
              className="text-[9px] font-medium"
              style={{
                color: isRunning ? "var(--accent)" :
                       isDone ? "var(--success)" :
                       isFailed ? "var(--danger)" :
                       "var(--text-tertiary)",
              }}
            >
              {ROLE_NL[task.status] || task.status}
            </span>
          </div>
        </div>

        {/* Status indicator */}
        {isRunning && (
          <div className="flex items-center gap-0.5 ml-2">
            <motion.div className="w-1 h-3 rounded-full bg-[var(--accent)]"
              animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.8, repeat: Infinity }}
            />
            <motion.div className="w-1 h-3 rounded-full bg-[var(--accent)]"
              animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.15 }}
            />
            <motion.div className="w-1 h-3 rounded-full bg-[var(--accent)]"
              animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.3 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主组件 ──

export function CollaborationStage() {
  const sid = useChatStore(s => s.activeSessionId);
  const tasks = useChatStore(s => sid ? s.tasks[sid] || EMPTY_ARRAY : EMPTY_ARRAY);
  const confirmedPlan = useChatStore(s => sid ? s.confirmedPlans[sid] : undefined);
  const agents = useAgentStore(s => s.agents);

  // 合并 confirmedPlan + WS 运行时
  const allTasks = useMemo(() => {
    const wsMap = new Map(tasks.map(t => [t.taskId, t]));
    const result = [...tasks];
    if (confirmedPlan?.tasks) {
      for (const pt of confirmedPlan.tasks) {
        if (!wsMap.has(pt.id)) {
          result.push({
            taskId: pt.id,
            title: pt.title,
            status: "pending" as const,
            agentId: pt.selected_agent_id || pt.agent_id || undefined,
          });
        }
      }
    }
    return result;
  }, [tasks, confirmedPlan]);

  const allDone = allTasks.length > 0 && allTasks.every(t => t.status === "done");
  const doneCount = allTasks.filter(t => t.status === "done").length;

  // ── 空状态 ──

  if (!sid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center opacity-40">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="19" cy="7" r="4"/><path d="M15 21v-2a4 4 0 0 1 4-4h2"/></svg>
        </div>
        <span className="text-[11px]">选择群聊查看协作</span>
      </div>
    );
  }

  if (allTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center opacity-40">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16c0-2 4-4 8-4s4 2 4 4"/></svg>
        </div>
        <span className="text-[11px]">发送需求后自动拆解任务</span>
      </div>
    );
  }

  // ── 舞台 ──

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] animate-fade-in relative">
      {/* 完成光晕 */}
      {allDone && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 50% at 50% 45%, rgba(91,140,122,0.04) 0%, transparent 60%)" }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
        />
      )}

      {/* 任务时间线 */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {allTasks.map((task, i) => {
          const agent = agents.find(a => a.id === task.agentId);
          return (
            <TaskRow
              key={task.taskId}
              task={task}
              agent={agent}
              isLast={i === allTasks.length - 1}
            />
          );
        })}
      </div>

      {/* 底部进度 */}
      <div className="shrink-0 border-t border-[var(--border)]/50 px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {doneCount}/{allTasks.length}
          </span>
          <div className="flex-1 h-1 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: allDone ? "var(--success)" : "var(--accent)" }}
              animate={{ width: `${allTasks.length > 0 ? (doneCount / allTasks.length) * 100 : 0}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
