"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentEditor } from "./AgentEditor";

const AGENT_COLORS: Record<string, string> = {
  deepseek: "from-purple-500 to-indigo-500",
  anthropic: "from-amber-400 to-orange-500",
  opencode: "from-blue-400 to-cyan-500",
};

const AGENT_EMOJI: Record<string, string> = {
  deepseek: "\u{1F9E0}", anthropic: "\u{2728}", opencode: "\u{1F527}",
};

export function LeftSidebar() {
  const agents = useAgentStore(s => s.agents);
  const setAgents = useAgentStore(s => s.setAgents);
  const sessions = useChatStore(s => s.sessions);
  const activeSessionId = useChatStore(s => s.activeSessionId);
  const setActiveSession = useChatStore(s => s.setActiveSession);
  const selectedContactId = useChatStore(s => s.selectedContactId);
  const setSelectedContact = useChatStore(s => s.setSelectedContact);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{id:string;name:string;systemPrompt:string;skills:string[];capabilityTags:string[];avatarUrl:string}|null>(null);
  const [contextMenu, setContextMenu] = useState<{x:number;y:number;agentId:string}|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/agents`).then(r => r.json()).then(data => {
      setAgents((data as Record<string,unknown>[]).map(a => ({
        id: a.id as string, name: a.name as string, avatarUrl: (a.avatar_url as string) || "",
        roleType: a.role_type as string, adapterType: a.adapter_type as string,
        capabilityTags: (a.capability_tags as string[]) || [],
        isDeletable: a.is_deletable as boolean,
      })));
      if (!selectedContactId && Array.isArray(data) && data.length > 0) setSelectedContact(data[0].id as string);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [setAgents]); // eslint-disable-line

  useEffect(() => { const h = () => setContextMenu(null); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, []);

  const handleNewChat = async () => {
    if (!selectedContactId) return;
    const r = await fetch(`${API_BASE}/api/sessions`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({title:"",type:"single",agent_ids:[selectedContactId]}),
    });
    if (r.ok) { const s = await r.json(); useChatStore.getState().setSessions([s, ...useChatStore.getState().sessions]); setActiveSession(s.id); }
  };

  const handleNewGroup = async () => {
    const allIds = agents.map(a => a.id);
    if (allIds.length < 2) return;
    const r = await fetch(`${API_BASE}/api/sessions`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({title:"群聊",type:"group",agent_ids:allIds.slice(0,3)}),
    });
    if (r.ok) { const s = await r.json(); useChatStore.getState().setSessions([s, ...useChatStore.getState().sessions]); setActiveSession(s.id); }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    if (deleting) return; setDeleting(sid);
    try {
      const r = await fetch(`${API_BASE}/api/sessions/${sid}`, {method:"DELETE"});
      if (r.ok) {
        if (activeSessionId === sid) { const rem = sessions.filter(s2 => s2.id !== sid); if (rem.length > 0) setActiveSession(rem[0].id); }
        const sr = await fetch(`${API_BASE}/api/sessions`); if (sr.ok) useChatStore.getState().setSessions(await sr.json());
      }
    } catch {} finally { setDeleting(null); }
  };

  const handleContextMenu = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    const agent = agents.find(a => a.id === agentId);
    if (!agent?.isDeletable) return;
    setContextMenu({ x: e.clientX, y: e.clientY, agentId });
  };

  const handleEditAgent = () => {
    if (!contextMenu) return;
    const agent = agents.find(a => a.id === contextMenu.agentId);
    if (agent) {
      // Fetch full agent details for system prompt
      fetch(`${API_BASE}/api/agents/${agent.id}`).then(r => r.json()).then(data => {
        setEditingAgent({ id: agent.id, name: agent.name, systemPrompt: data.system_prompt || "", skills: data.skills || [], capabilityTags: agent.capabilityTags || [], avatarUrl: agent.avatarUrl });
      }).catch(() => {
        setEditingAgent({ id: agent.id, name: agent.name, systemPrompt: "", skills: [], capabilityTags: agent.capabilityTags || [], avatarUrl: agent.avatarUrl });
      });
      setEditorOpen(true);
    }
    setContextMenu(null);
  };

  const handleDeleteAgent = async () => {
    if (!contextMenu) return;
    const aid = contextMenu.agentId; setContextMenu(null);
    try {
      const r = await fetch(`${API_BASE}/api/agents/${aid}`, {method:"DELETE"});
      if (r.ok) setAgents(agents.filter(a => a.id !== aid));
    } catch {}
  };

  const filteredSessions = search ? sessions.filter(s => (s.title||"").toLowerCase().includes(search.toLowerCase())) : sessions;

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7]">
      {/* Search */}
      <div className="p-3">
        <div className="flex items-center gap-2 bg-[#E5E5E7] rounded-[10px] px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86868B" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input className="flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:text-[#86868B]" placeholder="搜索 Agent 或会话" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Agents section */}
        <div className="px-3 pb-1">
          <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">Agents</h3>
          {loading ? (
            <div className="space-y-1">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            agents.map(agent => {
            const isActive = selectedContactId === agent.id;
            return (
              <div key={agent.id}
                onClick={() => setSelectedContact(agent.id)}
                onContextMenu={e => handleContextMenu(e, agent.id)}
                className={cn("relative flex items-center gap-3 px-2 py-2 rounded-[10px] cursor-pointer transition-all duration-150 hover-lift", isActive && "bg-white shadow-sm")}>
                {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#007AFF] rounded-full" />}
                <div className={cn("w-10 h-10 rounded-full bg-gradient-to-br flex items-center justify-center text-lg shrink-0", AGENT_COLORS[agent.adapterType] || "from-gray-400 to-gray-500")}>
                  {agent.roleType === "custom" ? (agent.avatarUrl ? <img src={agent.avatarUrl} className="w-10 h-10 rounded-full object-cover" alt={agent.name} /> : "👤") : (AGENT_EMOJI[agent.adapterType] || "\u{1F4A1}")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium truncate">{agent.name}</div>
                  <div className="flex gap-1 mt-0.5">{(agent.capabilityTags||[]).slice(0,2).map(tag => <span key={tag} className="text-[11px] text-[#86868B] bg-[#E5E5E7] rounded-md px-1.5 py-0.5 leading-none">{tag}</span>)}</div>
                </div>
              </div>
            );
          })
          )}
        </div>

        <div className="mx-3 border-t border-[#E5E5E7] my-2" />

        {/* Sessions section */}
        <div className="px-3 pb-16">
          <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">会话</h3>
          {loading ? (
            <div className="space-y-1">
              {[1,2].map(i => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : (<>
            {filteredSessions.map(s => {
              const isActive = activeSessionId === s.id;
              return (
                <div key={s.id} onClick={() => setActiveSession(s.id)}
                  className={cn("group relative flex items-center gap-3 px-2 py-2 rounded-[10px] cursor-pointer transition-all duration-150 hover-lift", isActive && "bg-white shadow-sm")}>
                  {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#007AFF] rounded-full" />}
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm shrink-0", s.type==="group"?"bg-[#E5E5E7]":"bg-gradient-to-br from-blue-400 to-blue-500")}>
                    {s.type==="group"?"#":"@"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium truncate">{s.title||"新聊天"}</div>
                    <div className="text-[12px] text-[#86868B]">{s.agentCount>0 && s.type==="group"?`群聊 · ${s.agentCount}人`:"单聊"}</div>
                  </div>
                  <button onClick={e=>handleDeleteSession(e,s.id)} className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-50 text-[#C7C7CC] hover:text-[#FF3B30]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              );
            })}
            {filteredSessions.length === 0 && (
              search ? <div className="text-center text-[13px] text-[#C7C7CC] py-8">无匹配结果</div>
              : <div className="text-center text-[13px] text-[#C7C7CC] py-8">暂无会话</div>
            )}
          </>)}
        </div>
      </ScrollArea>

      {/* Bottom buttons */}
      <div className="p-3 space-y-2">
        <button onClick={()=>{setEditingAgent(null);setEditorOpen(true);}} className="w-full py-2.5 rounded-[12px] bg-[#007AFF] text-white text-[15px] font-medium transition-all duration-150 hover:bg-[#0066D6] active:scale-[0.98]">+ 新建 Agent</button>
        <button onClick={handleNewChat} className="w-full py-2.5 rounded-[12px] bg-white border border-[#E5E5E7] text-[#1D1D1F] text-[15px] font-medium transition-all duration-150 hover:bg-[#F5F5F7] active:scale-[0.98]">+ 新建聊天</button>
        <button onClick={handleNewGroup} className="w-full py-2.5 rounded-[12px] bg-white border border-[#E5E5E7] text-[#1D1D1F] text-[15px] font-medium transition-all duration-150 hover:bg-[#F5F5F7] active:scale-[0.98]">+ 新建群聊</button>
      </div>

      {/* Agent Editor */}
      <AgentEditor open={editorOpen} onClose={() => setEditorOpen(false)} editAgent={editingAgent} />

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-white rounded-xl shadow-lg border border-[#E5E5E7] py-1 w-36 animate-fade-in" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={handleEditAgent} className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[#F5F5F7] transition-colors">编辑</button>
          <button onClick={handleDeleteAgent} className="w-full text-left px-4 py-2.5 text-[14px] text-[#FF3B30] hover:bg-red-50 transition-colors">删除</button>
        </div>
      )}
    </div>
  );
}
