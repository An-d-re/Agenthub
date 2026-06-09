"use client";

import { useEffect, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GroupEditor({ open, onClose }: Props) {
  const agents = useAgentStore(s => s.agents);
  const setActiveSession = useChatStore(s => s.setActiveSession);
  const [name, setName] = useState("群聊");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const customAgents = agents.filter(a => a.roleType !== "system");
  const systemAgentNames = agents
    .filter(a => a.roleType === "system")
    .map(a => a.name)
    .join(" 和 ");

  useEffect(() => {
    if (open) {
      setSelected(new Set(customAgents.slice(0, 3).map(a => a.id)));
      setSaving(false);
    }
  }, [open, agents]); // eslint-disable-line

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    const agentIds = Array.from(selected);
    if (!name.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name.trim(), type: "group", agent_ids: agentIds }),
      });
      if (r.ok) {
        const s = await r.json();
        useChatStore.getState().setSessions([s, ...useChatStore.getState().sessions]);
        setActiveSession(s.id);
        onClose();
      }
    } catch {} finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative w-[360px] h-full bg-[var(--bg-primary)] shadow-lg animate-spring flex flex-col"
        style={{ animation: "spring-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-[17px] font-semibold">新建群聊</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="text-[12px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">群名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="mt-2 w-full bg-[var(--bg-secondary)] border-0 rounded-xl px-4 py-3 text-[15px] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)] transition-all"
              placeholder="输入群聊名称"
              maxLength={30}
            />
          </div>

          <div>
            {systemAgentNames && (
              <div className="mb-3 text-[12px] text-[var(--text-secondary)] bg-[var(--accent)]/8 rounded-lg px-3 py-2">
                群聊将自动包含 {systemAgentNames}
              </div>
            )}
            <label className="text-[12px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">
              成员 · {selected.size}/{customAgents.length}
            </label>
            <div className="mt-2 space-y-1">
              {customAgents.map(agent => {
                const checked = selected.has(agent.id);
                return (
                  <button
                    key={agent.id}
                    onClick={() => toggle(agent.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      checked
                        ? "bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]/20"
                        : "hover:bg-[var(--bg-secondary)] dark:hover:bg-[var(--bg-secondary)]"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                      checked ? "bg-[var(--accent)] border-[var(--accent)]" : "border-[var(--text-tertiary)]"
                    )}>
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-[var(--text-primary)] dark:text-[var(--text-primary)]">{agent.name}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{agent.adapterType}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)]">
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className={cn(
              "w-full py-2.5 rounded-xl text-[15px] font-medium transition-all duration-150 active:scale-[0.98]",
              !name.trim()
                ? "bg-[var(--text-tertiary)] text-white cursor-not-allowed"
                : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
            )}
          >
            {saving ? "创建中..." : !name.trim() ? "请输入群聊名称" : "创建群聊"}
          </button>
        </div>
      </div>
    </div>
  );
}
