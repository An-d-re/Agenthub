"use client";

import { useChatStore } from "@/stores/chatStore";
import { EMPTY_ARRAY } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const S: Record<string,{label:string;dot:string;text:string}> = {
  done:{label:"完成",dot:"bg-[var(--success)]",text:"#34C759"},
  in_progress:{label:"执行中",dot:"bg-[var(--accent)] animate-pulse-blue",text:"#007AFF"},
  review:{label:"审查",dot:"bg-[var(--warning)]",text:"#FF9F0A"},
  retry:{label:"重试",dot:"bg-[var(--warning)]",text:"#FF9F0A"},
  blocked:{label:"已阻止",dot:"bg-[var(--danger)]",text:"#FF3B30"},
  dispute:{label:"争议",dot:"bg-[var(--danger)]",text:"#FF3B30"},
  pending:{label:"等待中",dot:"bg-[#C7C7CC]",text:"#C7C7CC"},
};

export function TaskPipeline() {
  const sid = useChatStore(s => s.activeSessionId);
  const tasks = useChatStore(s => sid ? (s.tasks[sid]||EMPTY_ARRAY) : EMPTY_ARRAY);
  const connectionStatus = useChatStore(s => s.connectionStatus);

  if (!sid) {
    return <div className="flex items-center justify-center h-full text-[13px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]">选择会话查看任务</div>;
  }

  if (connectionStatus === "connecting") {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#1C1C1E] px-4 py-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-2 w-full rounded-full" />
        {[1,2,3].map(i => (
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
    return <div className="flex items-center justify-center h-full text-[13px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]">暂无活跃任务</div>;
  }

  const done = tasks.filter(t => t.status==="done").length;
  // Group by inferred round (status grouping)
  const active = tasks.filter(t => t.status!=="done"&&t.status!=="pending");
  const pending = tasks.filter(t => t.status==="pending");

  return (
    <div className="flex flex-col h-full animate-fade-in bg-white dark:bg-[#1C1C1E]">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] dark:text-[var(--bg-secondary)]">Task Pipeline</h3>
          <span className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] tabular-nums">{done}/{tasks.length}</span>
        </div>
        <div className="h-1.5 bg-[var(--bg-secondary)] dark:bg-[#3A3A3C] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-700 ease-out"
            style={{width:`${Math.max((done/tasks.length)*100,4)}%`}} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {active.length > 0 && (
          <div className="mb-3">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">进行中</div>
            {active.map(t => {
              const c = S[t.status]||S.pending;
              return (
                <div key={t.taskId} className={cn("flex items-start gap-3 px-3 py-2.5 rounded-[12px] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-secondary)] transition-colors",t.status==="in_progress"&&"bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)]")}>
                  <div className={cn("w-2.5 h-2.5 rounded-full mt-1.5 shrink-0",c.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] truncate dark:text-[var(--bg-secondary)]">{t.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-medium" style={{color:c.text}}>{c.label}</span>
                      {t.error && <span className="text-[11px] text-[#FF3B30]/70 truncate">{t.error.slice(0,40)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pending.length > 0 && (
          <div className="mb-3">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">等待中</div>
            {pending.map(t => {
              const c = S.pending;
              return (
                <div key={t.taskId} className="flex items-start gap-3 px-3 py-2.5 rounded-[12px] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-secondary)] transition-colors">
                  <div className={cn("w-2.5 h-2.5 rounded-full mt-1.5 shrink-0",c.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)] truncate">{t.title}</div>
                    <span className="text-[11px]" style={{color:c.text}}>{c.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tasks.filter(t=>t.status==="done").map(t => (
          <div key={t.taskId} className="flex items-start gap-3 px-3 py-2.5 rounded-[12px] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-secondary)] transition-colors">
            <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 bg-[var(--success)]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] line-through truncate">{t.title}</div>
              <span className="text-[11px] text-[var(--success)] font-medium">完成</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
