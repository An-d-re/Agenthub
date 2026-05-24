"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";

function avatarEmoji(adapterType: string) {
  const map: Record<string, string> = {
    deepseek: "\u{1F9E0}",
    anthropic: "\u{1F916}",
    opencode: "\u{1F527}",
  };
  return map[adapterType] || "\u{1F4A1}";
}

export function AgentList() {
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const pendingRef = useRef<Set<string>>(new Set());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/agents`)
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: a.name as string,
          avatarUrl: (a.avatar_url as string) || "",
          roleType: a.role_type as string,
          adapterType: a.adapter_type as string,
          capabilityTags: (a.capability_tags as string[]) || [],
          isDeletable: a.is_deletable as boolean,
        })));
      })
      .catch((e) => { console.error("获取 Agent 列表失败:", e); });
  }, [setAgents]);

  // 当 session 被清空时重置选中状态
  useEffect(() => {
    if (!activeSessionId) {
      setSelectedAgentId(null);
    }
  }, [activeSessionId]);

  const handleClick = async (agentId: string) => {
    if (pendingRef.current.has(agentId)) return;
    pendingRef.current.add(agentId);

    setSelectedAgentId(agentId);

    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", type: "single", agent_ids: [agentId] }),
      });
      if (res.ok) {
        const session = await res.json();
        useChatStore.getState().setActiveSession(session.id);
        const sr = await fetch(`${API_BASE}/api/sessions`);
        if (sr.ok) {
          useChatStore.getState().setSessions(await sr.json());
        }
      }
    } catch {
      // 网络错误，稍后重试
    } finally {
      pendingRef.current.delete(agentId);
    }
  };

  return (
    <div>
      <div className="px-3 py-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          联系人
        </h3>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {agents.length}
        </span>
      </div>
      {agents.map((agent) => {
        const isSelected = selectedAgentId === agent.id;
        return (
          <div
            key={agent.id}
            onClick={() => handleClick(agent.id)}
            className={cn(
              "group relative mx-2 px-3 py-2.5 cursor-pointer rounded-md transition-all duration-150",
              "hover:bg-muted/60 active:scale-[0.98]",
              isSelected && "bg-muted/80"
            )}
          >
            {/* 左侧选中指示条 */}
            {isSelected && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-orange-500 rounded-r-full" />
            )}
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all duration-150",
                isSelected
                  ? "bg-orange-500/10 ring-1 ring-orange-500/30"
                  : "bg-muted group-hover:bg-muted/80"
              )}>
                {avatarEmoji(agent.adapterType)}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "text-sm truncate transition-colors duration-150",
                  isSelected && "font-medium text-foreground"
                )}>
                  {agent.name}
                </div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(agent.capabilityTags || []).slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
