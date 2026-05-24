"use client";

import { useChatStore } from "@/stores/chatStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; dotClass: string; textColor: string }> = {
  done: { label: "完成", dotClass: "bg-green-500", textColor: "#22c55e" },
  in_progress: { label: "执行中", dotClass: "bg-blue-500", textColor: "#3b82f6" },
  review: { label: "审查中", dotClass: "bg-amber-500", textColor: "#f59e0b" },
  retry: { label: "重试", dotClass: "bg-orange-500", textColor: "#f97316" },
  blocked: { label: "已阻止", dotClass: "bg-red-500", textColor: "#ef4444" },
  dispute: { label: "争议", dotClass: "bg-red-500", textColor: "#ef4444" },
  pending: { label: "等待中", dotClass: "bg-zinc-600", textColor: "#a1a1aa" },
};

export function TaskPipeline() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const tasks = useChatStore((s) =>
    activeSessionId ? (s.tasks[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY
  );

  if (!activeSessionId || tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-muted-foreground text-center px-4">
          暂无活跃任务
        </div>
      </div>
    );
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            任务流水线
          </h3>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {doneCount}/{tasks.length}
          </span>
        </div>
        <div className="mt-2 h-0.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500 ease-out rounded-full"
            style={{ width: `${(doneCount / tasks.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tasks.map((task) => {
          const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
          const isActive = task.status === "in_progress";

          return (
            <div
              key={task.taskId}
              className={cn(
                "px-4 py-3 border-b border-border/50 transition-colors",
                isActive && "bg-accent/5"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-1.5 shrink-0">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      config.dotClass,
                      isActive && "animate-pulse-glow"
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">
                    {task.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: config.textColor }}
                    >
                      {config.label}
                    </span>
                    {task.error && (
                      <span
                        className="text-[10px] text-destructive truncate"
                        title={task.error}
                      >
                        {task.error.slice(0, 40)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
