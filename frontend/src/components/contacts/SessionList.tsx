"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContacts } from "@/hooks/useContacts";
import { cn } from "@/lib/utils";

export function SessionList() {
  const { sessions, activeSessionId, setActiveSession, createSession } = useContacts();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          会话
        </h3>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground tabular-nums mr-1">
            {sessions.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => createSession("新聊天", "single")}
          >
            +
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {sessions.map((s) => {
          const isActive = activeSessionId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className={cn(
                "group relative mx-2 px-3 py-2.5 cursor-pointer rounded-md transition-all duration-150",
                "hover:bg-muted/60 active:scale-[0.98]",
                isActive && "bg-muted/80"
              )}
            >
              {/* 左侧选中指示条 */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-orange-500 rounded-r-full" />
              )}
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 transition-all duration-150",
                  isActive
                    ? "bg-orange-500/10 ring-1 ring-orange-500/30"
                    : "bg-muted group-hover:bg-muted/80"
                )}>
                  {s.type === "group" ? "#" : "@"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-sm truncate transition-colors duration-150",
                    isActive && "font-medium text-foreground"
                  )}>
                    {s.title || "未命名"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {s.agentCount > 0 ? `${s.agentCount} 个Agent` : "单聊"}
                    {s.lastMessagePreview && (
                      <span className="ml-1 opacity-60">
                        · {s.lastMessagePreview.slice(0, 15)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="text-center text-muted-foreground text-xs p-4">
            暂无会话，点击上方联系人开始
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
