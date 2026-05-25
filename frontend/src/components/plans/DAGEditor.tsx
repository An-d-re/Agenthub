"use client";

import { useState } from "react";
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

  if (tasks.length === 0) {
    return (
      <div className="flex justify-center w-full my-3 animate-spring">
        <div className="w-full max-w-xl text-center text-[13px] text-[#86868B] dark:text-[#98989D] py-6">
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
        <div className="text-[11px] text-muted-foreground/60 dark:text-[#98989D]/60 text-center uppercase tracking-widest font-medium">
          任务计划 · 确认后执行
        </div>

        {tasks.map((task) => {
          const isChecked = checked.has(task.id);
          return (
            <div
              key={task.id}
              className={cn(
                "rounded-2xl border p-4 transition-all duration-200 bg-white dark:bg-[#2C2C2E]",
                isChecked
                  ? "border-[#E5E5E7] dark:border-[#38383A] hover:border-accent/30"
                  : "border-[#E5E5E7]/50 dark:border-[#38383A]/50 opacity-50"
              )}
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggle(task.id)}
                  disabled={confirmed}
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all",
                    isChecked
                      ? "bg-[#007AFF] border-[#007AFF]"
                      : "border-[#C7C7CC]"
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
                    <span className="text-[14px] font-medium dark:text-[#F5F5F7]">
                      {task.id}. {task.title}
                    </span>
                    <span className="text-[10px] font-medium text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded-full">
                      {ROLE_LABELS[task.agent_role] || task.agent_role}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-[12px] text-[#86868B] dark:text-[#98989D] leading-relaxed line-clamp-2">
                      {task.description}
                    </p>
                  )}
                  {task.dependencies.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[10px] text-[#C7C7CC] dark:text-[#636366]">依赖:</span>
                      {task.dependencies.map((dep) => (
                        <span key={dep} className="text-[10px] text-[#86868B] dark:text-[#98989D] bg-[#F5F5F7] dark:bg-[#3A3A3C] px-1.5 py-0.5 rounded-full">
                          {dep}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!confirmed && (
                  <button
                    onClick={() => onDelete(task.id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#C7C7CC] dark:text-[#636366] hover:text-[#FF3B30] hover:bg-red-50 dark:hover:bg-red-50/20 transition-colors shrink-0"
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
          <span className="text-[12px] text-[#86868B] dark:text-[#98989D]">
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
