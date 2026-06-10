"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/constants";
import type { DAGTask, ModelOption } from "@/stores/chatStore";

interface Props {
  tasks: DAGTask[];
  onConfirm: (assignments: Record<string, unknown>[]) => void;
  onDelete: (taskId: string) => void;
}

const CAPABILITY_LABELS: Record<string, string> = {
  calculate: "计算",
  code: "编码",
  verify: "验证",
  design: "设计",
  analyze: "分析",
  write: "写作",
  data: "数据",
};

export function DAGEditor({ tasks, onConfirm, onDelete }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(tasks.map((t) => t.id)));
  const [confirmed, setConfirmed] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // 每个任务的执行者配置
  const [taskConfigs, setTaskConfigs] = useState<
    Record<string, { mode: "existing" | "new"; agentId: string | null; adapterType: string; apiKey: string }>
  >({});

  useEffect(() => {
    fetch(`${API_BASE}/api/models/available`)
      .then((r) => r.json())
      .then((data) => setModels(data.models || []))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      tasks.forEach((t) => {
        if (prev.has(t.id)) next.add(t.id);
        else next.add(t.id);
      });
      return next;
    });

    // 初始化任务配置
    setTaskConfigs((prev) => {
      const cfg: Record<string, typeof prev[string]> = {};
      tasks.forEach((t) => {
        const existing = prev[t.id];
        if (existing) {
          cfg[t.id] = existing;
        } else {
          cfg[t.id] = {
            mode: t.executor_type,
            agentId: t.agent_id,
            adapterType: models[0]?.adapter_type || "deepseek",
            apiKey: "",
          };
        }
      });
      return cfg;
    });
  }, [tasks, models]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateConfig = (
    taskId: string,
    patch: Partial<{ mode: "existing" | "new"; agentId: string | null; adapterType: string; apiKey: string }>
  ) => {
    setTaskConfigs((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], ...patch },
    }));
  };

  const [showKeyInputFor, setShowKeyInputFor] = useState<string | null>(null);

  const handleConfirm = () => {
    setConfirmed(true);
    const assignments: Record<string, unknown>[] = [];
    tasks.forEach((t) => {
      const cfg = taskConfigs[t.id];
      if (!cfg || !checked.has(t.id)) return;
      if (cfg.mode === "existing") {
        assignments.push({ task_id: t.id, agent_id: cfg.agentId, adapter_type: null, api_key: null });
      } else {
        assignments.push({
          task_id: t.id,
          agent_id: null,
          adapter_type: cfg.adapterType,
          api_key: cfg.apiKey || null,
        });
      }
    });
    onConfirm(assignments);
  };

  if (tasks.length === 0) {
    return (
      <div className="flex justify-center w-full my-3 animate-spring">
        <div className="w-full max-w-xl text-center text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] py-6">
          所有任务已移除。请发送新的需求重新规划。
        </div>
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => checked.has(t.id));

  return (
    <div className="flex justify-center w-full my-3 animate-spring">
      <div className="w-full max-w-xl space-y-3">
        <div className="text-[11px] text-muted-foreground/60 dark:text-[var(--text-secondary)]/60 text-center uppercase tracking-widest font-medium">
          任务计划 · 指定执行者后确认
        </div>

        {tasks.map((task) => {
          const isChecked = checked.has(task.id);
          const cfg = taskConfigs[task.id];
          const needsNewAgent = task.executor_type === "new";

          return (
            <div
              key={task.id}
              className={cn(
                "rounded-2xl border p-4 transition-all duration-200 bg-[var(--bg-primary)] dark:bg-[var(--bg-secondary)]",
                isChecked
                  ? "border-[var(--border)] hover:border-accent/30"
                  : "border-[var(--border)] opacity-50"
              )}
            >
              {/* 任务标题行 */}
              <div className="flex items-start gap-3 mb-3">
                <button
                  onClick={() => toggle(task.id)}
                  disabled={confirmed}
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
                    isChecked
                      ? "bg-[var(--accent)] border-[var(--accent)]"
                      : "border-[var(--text-tertiary)]"
                  )}
                >
                  {isChecked && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[14px] font-medium dark:text-[var(--text-primary)]">
                      {task.id}. {task.title}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded-full">
                      {CAPABILITY_LABELS[task.required_capability] || task.required_capability}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}
                  {task.dependencies.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]">依赖:</span>
                      {task.dependencies.map((dep) => (
                        <span key={dep} className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-full">
                          {dep}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!confirmed && (
                  <button
                    onClick={() => onDelete(task.id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)] hover:text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-50/20 transition-colors shrink-0"
                    title="删除任务"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              {/* 执行者选择行 */}
              {!confirmed && cfg && (
                <div className="ml-8 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">执行者</span>
                    <select
                      value={cfg.mode}
                      onChange={(e) => updateConfig(task.id, { mode: e.target.value as "existing" | "new" })}
                      className="text-[12px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--accent)]"
                    >
                      {task.agent_id && (
                        <option value="existing">
                          {task.agent_name}（复用 · {task.match_reason}）
                        </option>
                      )}
                      <option value="new">
                        {needsNewAgent ? `新建 ${CAPABILITY_LABELS[task.required_capability] || ""}Agent` : "新建Agent"}
                      </option>
                    </select>
                  </div>

                  {/* 新建 Agent 时的模型选择 */}
                  {cfg.mode === "new" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">模型</span>
                      {modelsLoading ? (
                        <span className="text-[11px] text-[var(--text-tertiary)]">加载中…</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {models.map((m) => (
                            <button
                              key={m.adapter_type}
                              onClick={() => {
                                updateConfig(task.id, { adapterType: m.adapter_type, apiKey: "" });
                                if (m.needs_key) {
                                  setShowKeyInputFor(task.id);
                                }
                              }}
                              className={cn(
                                "text-[11px] px-2 py-1 rounded-full border transition-colors flex items-center gap-1",
                                cfg.adapterType === m.adapter_type
                                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                                  : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/30"
                              )}
                            >
                              <span>{m.icon}</span>
                              <span>{m.name}</span>
                              {m.available && <span className="text-[9px] text-[var(--success)]">✓</span>}
                              {m.needs_key && <span className="text-[9px] text-[var(--warning)]">+Key</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* API Key 输入 */}
                  {(showKeyInputFor === task.id || (cfg.mode === "new" && cfg.adapterType && models.find((m) => m.adapter_type === cfg.adapterType)?.needs_key)) && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">Key</span>
                      <input
                        type="password"
                        value={cfg.apiKey}
                        onChange={(e) => updateConfig(task.id, { apiKey: e.target.value })}
                        placeholder="输入 API Key…"
                        className="text-[12px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--accent)] w-48"
                      />
                      <span className="text-[10px] text-[var(--text-tertiary)]">加密存储</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-2">
          <span className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {activeTasks.length}/{tasks.length} 个任务
          </span>
          <Button
            onClick={handleConfirm}
            disabled={confirmed || activeTasks.length === 0}
            size="sm"
            className="text-[13px] h-9 rounded-full px-5"
          >
            {confirmed ? "已确认 ✓" : "确认执行"}
          </Button>
        </div>
      </div>
    </div>
  );
}
