"use client";

import { useMemo } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { AgentIcon } from "@/lib/agentIcons";

const ADAPTER_COLORS: Record<string, string> = {
  deepseek: "#a855f7", anthropic: "#f59e0b", opencode: "#3b82f6", codex: "#06b6d4",
};

const STATUS_NL: Record<string, string> = {
  pending: "待完成", running: "执行中", reviewing: "审查中", done: "完成",
  failed: "失败", blocked: "阻塞", retrying: "重试", dispute: "退回", cancelled: "取消",
};

export function CollaborationStage() {
  const sid = useChatStore(s => s.activeSessionId);
  const tasks = useChatStore(s => sid ? s.tasks[sid] || EMPTY_ARRAY : EMPTY_ARRAY);
  const confirmedPlan = useChatStore(s => sid ? s.confirmedPlans[sid] : undefined);
  const agents = useAgentStore(s => s.agents);

  // 合并 confirmedPlan + WS 运行时
  const allTasks = useMemo(() => {
    const wsById = new Map(tasks.map(t => [t.taskId, t]));
    const seen = new Set<string>();
    const result: typeof tasks = [];
    if (confirmedPlan?.tasks) {
      for (const pt of confirmedPlan.tasks) {
        const dbId = pt.db_id || pt.id;
        seen.add(dbId);
        const planAgentId = pt.selected_agent_id || pt.agent_id || undefined;
        const existing = wsById.get(dbId);
        result.push({
          taskId: dbId,
          title: pt.title,
          status: existing?.status || "pending",
          agentId: planAgentId || existing?.agentId,
        });
      }
    }
    for (const t of tasks) {
      if (!seen.has(t.taskId)) result.push({ ...t });
    }
    return result;
  }, [tasks, confirmedPlan]);

  const doneCount = allTasks.filter(t => t.status === "done").length;
  const allDone = allTasks.length > 0 && doneCount === allTasks.length;

  if (!sid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <span className="text-[12px]">选择群聊查看协作</span>
      </div>
    );
  }

  if (allTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-tertiary)]">
        <span className="text-[12px]">发送需求后自动拆解任务</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {allTasks.map((task, i) => {
          const agent = agents.find(a => a.id === task.agentId);
          const isDone = task.status === "done";
          const isRunning = task.status === "running" || task.status === "reviewing";
          const isFailed = task.status === "failed" || task.status === "blocked" || task.status === "dispute";
          const isPending = task.status === "pending";
          const agentColor = agent ? ADAPTER_COLORS[agent.adapterType] || "#6b7280" : "#6b7280";
          const isLast = i === allTasks.length - 1;

          return (
            <div key={task.taskId} className="flex" style={{ minHeight: isLast ? 36 : 56 }}>
              {/* 左：点 + 连线 */}
              <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                {/* 圆点 */}
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center transition-colors duration-300"
                  style={{
                    background: isPending
                      ? "var(--bg-tertiary)"
                      : isDone
                        ? "var(--success)"
                        : isFailed
                          ? "var(--danger)"
                          : agentColor,
                    opacity: isPending ? 0.4 : 1,
                    border: isPending ? "2px solid var(--border)" : "2px solid transparent",
                  }}
                >
                  {isDone && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {isRunning && agent && <AgentIcon adapterType={agent.adapterType} size={10} />}
                  {isRunning && !agent && (
                    <span className="text-[7px] font-bold text-white">?</span>
                  )}
                </div>

                {/* 连线 */}
                {!isLast && (
                  <div
                    className="flex-1 transition-colors duration-300"
                    style={{
                      width: 2,
                      background: isDone ? "var(--success)" : "var(--border)",
                      opacity: isDone ? 0.5 : 0.35,
                    }}
                  />
                )}
              </div>

              {/* 右：任务信息 */}
              <div className="flex-1 ml-2 flex items-center" style={{ marginBottom: isLast ? 0 : 4 }}>
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[12px] font-medium leading-tight truncate transition-colors duration-300"
                    style={{
                      color: isDone ? "var(--success)" : isRunning ? "var(--text-primary)" : isFailed ? "var(--danger)" : "var(--text-secondary)",
                      opacity: isPending ? 0.55 : 1,
                    }}
                  >
                    {task.title}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {agent && (
                      <span className="text-[10px] text-[var(--text-tertiary)] truncate max-w-[90px]">{agent.name}</span>
                    )}
                    <span
                      className="text-[10px] font-medium"
                      style={{
                        color: isRunning ? "var(--accent)" : isDone ? "var(--success)" : isFailed ? "var(--danger)" : "var(--text-tertiary)",
                      }}
                    >
                      {STATUS_NL[task.status] || task.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部进度 */}
      <div className="shrink-0 border-t border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {doneCount}/{allTasks.length}
          </span>
          <div className="flex-1 h-1 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${allTasks.length > 0 ? (doneCount / allTasks.length) * 100 : 0}%`,
                background: allDone ? "var(--success)" : "var(--accent)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
