"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContacts } from "@/hooks/useContacts";
import { cn } from "@/lib/utils";

export function SessionList() {
  const { sessions, activeSessionId, setActiveSession, createSession } = useContacts();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          会话
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="h-6 w-6 p-0 text-xs"
          onClick={() => createSession("新聊天", "single")}
        >
          ＋
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveSession(s.id)}
            className={cn(
              "px-4 py-2 cursor-pointer hover:bg-muted/50",
              activeSessionId === s.id && "bg-muted"
            )}
          >
            <div className="text-sm truncate">{s.title || "未命名"}</div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {s.agentCount > 0 ? `${s.agentCount} 个Agent` : "单聊"}
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-center text-muted-foreground text-xs p-4">
            暂无会话
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
