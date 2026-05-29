"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DAGTask } from "@/stores/chatStore";

interface Props {
  tasks: DAGTask[];
  onConfirm: () => void;
  onDelete: (taskId: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  coder: "Coder",
  reviewer: "Reviewer",
  planner: "Planner",
  critic: "Critic",
  architect: "Architect",
};

export function DAGEditor({ tasks, onConfirm, onDelete }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(tasks.map((t) => t.id)));
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>();
      tasks.forEach((t) => {
        if (prev.has(t.id)) next.add(t.id);
      });
      tasks.forEach((t) => {
        if (!next.has(t.id)) next.add(t.id);
      });
      return next;
    });
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex justify-center w-full my-3 animate-spring">
        <div className="w-full max-w-xl text-center text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] py-6">
          所有任务已移除。请发送新的需求重新规划。
        </div>
      </div>
    );
  }

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    setConfirmed(true);
    onConfirm();
  };

  const activeTasks = tasks.filter((t) => checked.has(t.id));

  return (
    <div className="flex justify-center w-full my-3 animate-spring">
      <div className="w-full max-w-xl space-y-3">
        <div className="text-[11px] text-muted-foreground/60 dark:text-[var(--text-secondary)]/60 text-center uppercase tracking-widest font-medium">
          任务计划 · 确认后执行
        </div>

        {tasks.map((task) => {
          const isChecked = checked.has(task.id);
          return (
            <div
              key={task.id}
              className={cn(
                "rounded-2xl border p-4 transition-all duration-200 bg-[var(--bg-primary)] dark:bg-[var(--bg-secondary)]",
                isChecked
                  ? "border-[var(--border)] hover:border-accent/30"
                  : "border-[var(--border)]/50 opacity-50"
              )}
            >
              <div className="flex items-start gap-3">
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
                    <span className="text-[14px] font-medium dark:text-[var(--bg-secondary)]">
                      {task.id}. {task.title}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded-full">
                      {ROLE_LABELS[task.agent_role] || task.agent_role}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}
                  {task.dependencies.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
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
