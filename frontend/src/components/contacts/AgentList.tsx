"use client";

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function AgentList() {
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);

  useEffect(() => {
    fetch(`${API_BASE}/api/agents`)
      .then((r) => r.json())
      .then((data) => {
        // Normalize snake_case API response to camelCase
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
      .catch(() => {});
  }, [setAgents]);

  const handleClick = async (agentId: string) => {
    // Create a single-chat session with this agent
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", type: "single", agent_ids: [agentId] }),
    });
    if (res.ok) {
      const session = await res.json();
      useChatStore.getState().setActiveSession(session.id);
      // Refresh sessions list
      const sr = await fetch(`${API_BASE}/api/sessions`);
      if (sr.ok) {
        useChatStore.getState().setSessions(await sr.json());
      }
    }
  };

  const avatarEmoji = (agent: { adapterType: string }) => {
    const map: Record<string, string> = {
      deepseek: "\u{1F9E0}",   // brain
      anthropic: "\u{1F916}",   // robot
      opencode: "\u{1F527}",    // wrench
    };
    return map[agent.adapterType] || "\u{1F4A1}";
  };

  return (
    <div>
      <h3 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        联系人
      </h3>
      {agents.map((agent) => (
        <div
          key={agent.id}
          onClick={() => handleClick(agent.id)}
          className="px-4 py-2 cursor-pointer hover:bg-muted/50 flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-lg">
            {avatarEmoji(agent)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{agent.name}</div>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {(agent.capabilityTags || []).slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
