"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/lib/agentIcons";

// ── 自然语言状态映射 ──

const STATUS_NL: Record<string, { text: string; emoji: string }> = {
  running: { text: "工作中…", emoji: "" },
  reviewing: { text: "正在审查…", emoji: "" },
  done: { text: "已完成", emoji: "✓" },
  pending: { text: "等待中", emoji: "" },
  failed: { text: "出错了", emoji: "!" },
  blocked: { text: "已阻止", emoji: "" },
  retrying: { text: "重试中…", emoji: "" },
  dispute: { text: "有争议", emoji: "" },
  cancelled: { text: "已取消", emoji: "" },
};

const ADAPTER_COLORS: Record<string, string> = {
  deepseek: "#a855f7",
  anthropic: "#f59e0b",
  opencode: "#3b82f6",
  codex: "#06b6d4",
};

// ── 单个 Agent 节点 ──

function AgentNode({
  agent,
  status,
}: {
  agent: { id: string; name: string; adapterType: string; avatarUrl?: string };
  status: string;
}) {
  const isRunning = status === "running" || status === "reviewing";
  const isDone = status === "done";
  const isFailed = status === "failed" || status === "blocked" || status === "dispute";
  const color = ADAPTER_COLORS[agent.adapterType] || "#6b7280";
  const nl = STATUS_NL[status] || STATUS_NL.pending;

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      {/* Avatar with glow */}
      <div className="relative">
        {isRunning && (
          <>
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: color }}
              initial={{ opacity: 0.3, scale: 1 }}
              animate={{ opacity: 0, scale: 1.6 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: color }}
              initial={{ opacity: 0.2, scale: 1 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.7 }}
            />
          </>
        )}
        {isDone && (
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--success)] flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </motion.div>
        )}
        <div
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center text-white transition-all duration-300",
            isRunning ? "ring-2 ring-offset-2 ring-offset-[var(--bg-primary)]" : "",
            isDone ? "opacity-90" : isFailed ? "opacity-50" : "opacity-60",
          )}
          style={{
            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
            ...(isRunning ? { ringColor: color } : {}),
          }}
        >
          {agent.avatarUrl ? (
            <img src={agent.avatarUrl} className="w-12 h-12 rounded-full object-cover" alt={agent.name} />
          ) : (
            <AgentIcon adapterType={agent.adapterType} size={18} />
          )}
        </div>
      </div>

      {/* Name */}
      <span className="text-[12px] font-semibold text-[var(--text-primary)] text-center leading-tight max-w-[72px] truncate">
        {agent.name}
      </span>

      {/* Status */}
      <span
        className={cn(
          "text-[10px] font-medium transition-colors",
          isRunning ? "text-[var(--accent)]" :
          isDone ? "text-[var(--success)]" :
          isFailed ? "text-[var(--danger)]" :
          "text-[var(--text-tertiary)]",
        )}
      >
        {nl.emoji && <span className="mr-0.5">{nl.emoji}</span>}
        {nl.text}
      </span>
    </div>
  );
}

// ── DAG 依赖连线 ──

function DependencyLines({
  deps,
  nodePositions,
}: {
  deps: { from: string; to: string }[];
  nodePositions: Record<string, { x: number; y: number }>;
}) {
  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ overflow: "visible" }}>
      {deps.map((dep, i) => {
        const from = nodePositions[dep.from];
        const to = nodePositions[dep.to];
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2;
        return (
          <g key={`${dep.from}-${dep.to}`}>
            <path
              d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
              fill="none"
              stroke="var(--accent)"
              strokeOpacity="0.15"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <motion.circle r="2" fill="var(--accent)" fillOpacity="0.5">
              <animateMotion
                dur="2s"
                repeatCount="indefinite"
                begin={`${i * 0.4}s`}
                path={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
              />
            </motion.circle>
          </g>
        );
      })}
    </svg>
  );
}

// ── 主组件 ──

export function CollaborationStage() {
  const sid = useChatStore((s) => s.activeSessionId);
  const tasks = useChatStore((s) => (sid ? s.tasks[sid] || EMPTY_ARRAY : EMPTY_ARRAY));
  const confirmedPlan = useChatStore((s) => (sid ? s.confirmedPlans[sid] : undefined));
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);

  // 按 Agent 聚合任务状态
  const agentStatuses = useMemo(() => {
    const map: Record<string, { status: string; taskTitle: string }> = {};
    for (const t of tasks) {
      const aid = t.agentId || "unknown";
      const existing = map[aid];
      // 优先级：running > reviewing > retrying > failed > done > pending
      const order = ["running", "reviewing", "retrying", "failed", "blocked", "dispute", "done", "pending", "cancelled"];
      const currentRank = existing ? order.indexOf(existing.status) : 99;
      const newRank = order.indexOf(t.status);
      if (!existing || newRank < currentRank) {
        map[aid] = { status: t.status, taskTitle: t.title };
      }
    }
    return map;
  }, [tasks]);

  // 从 confirmedPlan 提取依赖关系
  const dagDeps = useMemo(() => {
    if (!confirmedPlan?.tasks) return [];
    const deps: { from: string; to: string }[] = [];
    for (const t of confirmedPlan.tasks) {
      if (!t.selected_agent_id) continue;
      for (const depId of t.dependencies) {
        const depTask = confirmedPlan.tasks.find(d => d.id === depId);
        if (depTask?.selected_agent_id) {
          deps.push({ from: depTask.selected_agent_id, to: t.selected_agent_id });
        }
      }
    }
    return deps;
  }, [confirmedPlan]);

  const relevantAgents = useMemo(() => {
    const agentIds = new Set(Object.keys(agentStatuses));
    if (agentIds.size === 0 && confirmedPlan?.tasks) {
      // 任务还没开始，显示 DAG 中的所有 Agent
      for (const t of confirmedPlan.tasks) {
        if (t.selected_agent_id) agentIds.add(t.selected_agent_id);
      }
    }
    return agents.filter(a => agentIds.has(a.id));
  }, [agents, agentStatuses, confirmedPlan]);

  const allDone = tasks.length > 0 && tasks.every(t => t.status === "done");
  const hasRunning = tasks.some(t => t.status === "running" || t.status === "reviewing");
  const doneCount = tasks.filter(t => t.status === "done").length;

  // ── 空／加载态 ──

  if (!sid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="opacity-30">
          <circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          <circle cx="19" cy="7" r="4" /><path d="M15 21v-2a4 4 0 0 1 4-4h2" />
        </svg>
        <span className="text-[13px]">选择群聊查看协作</span>
      </div>
    );
  }

  if (connectionStatus === "connecting") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-[var(--accent)]"
              animate={{ opacity: [0.2, 0.7, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (tasks.length === 0 && !confirmedPlan?.tasks?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="opacity-30">
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="9" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" />
          <path d="M8 16c0-2 4-4 8-4s4 2 4 4" />
        </svg>
        <span className="text-[13px]">发送需求后这里会展示 Agent 协作</span>
      </div>
    );
  }

  // ── 渲染 ──

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] animate-fade-in">
      {/* Header */}
      <div className="shrink-0 px-4 py-4 border-b border-[var(--border)]/50">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">协作剧场</h3>
          <span className="text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
            {doneCount}/{tasks.length}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
          {allDone
            ? "所有任务已完成，Agent 团队协作成功 🎉"
            : hasRunning
              ? "Agent 们正在协作完成任务…"
              : "等待 Agent 开始工作…"}
        </p>
      </div>

      {/* Agent Ring + Flow */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 relative">
        {/* 完成庆祝背景 */}
        <AnimatePresence>
          {allDone && (
            <motion.div
              className="absolute inset-0 rounded-2xl"
              style={{ background: "radial-gradient(ellipse at center, var(--success)/5 0%, transparent 70%)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
            />
          )}
        </AnimatePresence>

        {/* 依赖连线层 */}
        {dagDeps.length > 1 && (
          <DependencyLines
            deps={dagDeps}
            nodePositions={
              // 估算位置：环状或水平排列
              relevantAgents.reduce((acc, agent, i) => {
                const total = relevantAgents.length;
                const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
                const r = 80;
                acc[agent.id] = {
                  x: 160 + Math.cos(angle) * r,
                  y: 120 + Math.sin(angle) * r + 30,
                };
                return acc;
              }, {} as Record<string, { x: number; y: number }>)
            }
          />
        )}

        {/* Agent 头像环 */}
        <div className="flex flex-wrap items-start justify-center gap-5">
          {relevantAgents.map((agent) => {
            const s = agentStatuses[agent.id];
            return (
              <AgentNode
                key={agent.id}
                agent={agent}
                status={s?.status || "pending"}
              />
            );
          })}
        </div>

        {/* 无 Agent 但有待执行计划时，显示占位 */}
        {relevantAgents.length === 0 && confirmedPlan?.tasks && confirmedPlan.tasks.length > 0 && (
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              {confirmedPlan.tasks.slice(0, 5).map((t, i) => (
                <motion.div
                  key={t.id}
                  className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[11px] text-[var(--text-tertiary)]"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 0.5, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  {t.title[0]}
                </motion.div>
              ))}
            </div>
            <span className="text-[12px] text-[var(--text-tertiary)]">计划已就绪，等待执行…</span>
          </div>
        )}

        {/* 审查回路提示 */}
        {tasks.some(t => t.status === "dispute") && (
          <motion.div
            className="mt-4 px-3 py-1.5 rounded-full bg-[var(--warning)]/10 border border-[var(--warning)]/20"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="text-[11px] font-medium text-[var(--warning)]">
              Reviewer 将代码退回，Coder 正在修改…
            </span>
          </motion.div>
        )}
      </div>

      {/* 任务摘要列表（折叠在底部） */}
      {tasks.length > 0 && (
        <div className="shrink-0 border-t border-[var(--border)]/50 px-4 py-3 max-h-[160px] overflow-y-auto">
          {tasks.map(t => {
            const agent = agents.find(a => a.id === t.agentId);
            return (
              <div key={t.taskId} className="flex items-center gap-2 py-1">
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    t.status === "running" ? "bg-[var(--accent)]" :
                    t.status === "reviewing" ? "bg-[var(--warning)]" :
                    t.status === "done" ? "bg-[var(--success)]" :
                    t.status === "failed" || t.status === "blocked" || t.status === "dispute" ? "bg-[var(--danger)]" :
                    "bg-[var(--text-tertiary)]",
                  )}
                />
                <span className="text-[12px] text-[var(--text-primary)] truncate flex-1">{t.title}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                  {agent?.name?.slice(0, 6) || ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
