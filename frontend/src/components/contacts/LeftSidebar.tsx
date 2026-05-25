"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentEditor } from "./AgentEditor";

type TabKey = "agents" | "groups" | "topics";

const AGENT_COLORS: Record<string, string> = {
  deepseek: "from-purple-500 to-indigo-500",
  anthropic: "from-amber-400 to-orange-500",
  opencode: "from-blue-400 to-cyan-500",
  codex: "from-cyan-400 to-teal-500",
};

const AGENT_EMOJI: Record<string, string> = {
  deepseek: "\u{1F9E0}", anthropic: "\u{2728}", opencode: "\u{1F527}", codex: "\u{1F4E6}",
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
  const [tab, setTab] = useState<TabKey>("agents");

  // Tab indicator positions
  const tabRefs: Record<TabKey, number> = { agents: 12, groups: 104, topics: 196 };

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

  // Sessions by type
  const groupSessions = sessions.filter(s => s.type === "group");
  const singleSessions = sessions.filter(s => s.type === "single");

  // Topics (= single sessions) for the selected agent
  const agentTopics = selectedContactId
    ? singleSessions.filter(s => {
        const ids = (s as unknown as Record<string,unknown>).agent_ids as string[] | undefined;
        return ids ? ids.includes(selectedContactId) : false;
      })
    : [];

  const selectedAgent = agents.find(a => a.id === selectedContactId);

  // ── Action handlers ──

  const handleNewAgent = () => { setEditingAgent(null); setEditorOpen(true); };

  const handleNewGroup = async () => {
    const allIds = agents.map(a => a.id);
    if (allIds.length < 2) return;
    const r = await fetch(`${API_BASE}/api/sessions`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({title:"群聊",type:"group",agent_ids:allIds.slice(0,3)}),
    });
    if (r.ok) { const s = await r.json(); useChatStore.getState().setSessions([s, ...sessions]); setActiveSession(s.id); setTab("groups"); }
  };

  const handleNewTopic = async () => {
    if (!selectedContactId) return;
    const topicNum = agentTopics.length + 1;
    const r = await fetch(`${API_BASE}/api/sessions`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({title:`新对话 ${topicNum}`,type:"single",agent_ids:[selectedContactId]}),
    });
    if (r.ok) { const s = await r.json(); useChatStore.getState().setSessions([s, ...sessions]); setActiveSession(s.id); }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    if (deleting) return; setDeleting(sid);
    try {
      const r = await fetch(`${API_BASE}/api/sessions/${sid}`, {method:"DELETE"});
      if (r.ok) {
        const allSessions = useChatStore.getState().sessions;
        if (activeSessionId === sid) { const rem = allSessions.filter(s2 => s2.id !== sid); if (rem.length > 0) setActiveSession(rem[0].id); }
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

  // ── Bot button config ──

  const bottomBtn = (() => {
    switch (tab) {
      case "agents": return { label: "+ 新建助手", onClick: handleNewAgent, disabled: false };
      case "groups": return { label: "+ 新建群聊", onClick: handleNewGroup, disabled: agents.length < 2 };
      case "topics": return selectedContactId
        ? { label: "+ 新建话题", onClick: handleNewTopic, disabled: false }
        : { label: "请先选择一个助手", onClick: () => { setTab("agents"); }, disabled: true };
    }
  })();

  const TABS: { key: TabKey; icon: string; label: string }[] = [
    { key: "agents", icon: "🤖", label: "助手" },
    { key: "groups", icon: "👥", label: "群聊" },
    { key: "topics", icon: "💬", label: "话题" },
  ];

  const searchFilter = (text: string) => !search || text.toLowerCase().includes(search.toLowerCase());

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] dark:bg-[#1C1C1E]">
      {/* Tab bar — frosted glass */}
      <div className="shrink-0 bg-[#F5F5F7]/80 dark:bg-[#1C1C1E]/80 backdrop-blur-xl border-b border-[#E5E5E7]/50 dark:border-[#38383A]/50">
        <div className="flex relative h-[48px]">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 text-[12px] font-medium transition-colors duration-200",
                tab === t.key ? "text-[#1D1D1F] dark:text-[#F5F5F7]" : "text-[#86868B] dark:text-[#98989D] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7]"
              )}
            >
              <span className="text-[13px]">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          {/* Sliding indicator */}
          <motion.div
            className="absolute bottom-0 h-[3px] bg-[#007AFF] rounded-full"
            animate={{ left: tabRefs[tab], width: 80 }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        </div>
      </div>

      {/* Search */}
      <div className="p-3 shrink-0">
        <div className="flex items-center gap-2 bg-[#E5E5E7] dark:bg-[#2C2C2E] rounded-[10px] px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86868B" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input className="flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:text-[#86868B] dark:text-[#F5F5F7] dark:placeholder:text-[#636366]" placeholder={`搜索${TABS.find(t => t.key === tab)?.label || ""}`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {/* ── 助手 Tab ── */}
          {tab === "agents" && (
            <motion.div key="agents" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="px-3 pb-16">
              {loading ? (
                <div className="space-y-1">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex items-center gap-3 px-2 py-2">
                      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-16" /></div>
                    </div>
                  ))}
                </div>
              ) : (
                agents.filter(a => searchFilter(a.name)).map(agent => {
                  const isActive = selectedContactId === agent.id;
                  return (
                    <div key={agent.id}
                      onClick={() => { setSelectedContact(agent.id); setTab("topics"); }}
                      onContextMenu={e => handleContextMenu(e, agent.id)}
                      className={cn("relative flex items-center gap-3 px-2 py-2 rounded-[10px] cursor-pointer transition-all duration-150 hover-lift", isActive && "bg-white dark:bg-[#2C2C2E] shadow-sm")}>
                      {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#007AFF] rounded-full" />}
                      <div className={cn("w-10 h-10 rounded-full bg-gradient-to-br flex items-center justify-center text-lg shrink-0", AGENT_COLORS[agent.adapterType] || "from-gray-400 to-gray-500")}>
                        {agent.roleType === "custom" ? (agent.avatarUrl ? <img src={agent.avatarUrl} className="w-10 h-10 rounded-full object-cover" alt={agent.name} /> : "👤") : (AGENT_EMOJI[agent.adapterType] || "\u{1F4A1}")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-medium truncate dark:text-[#F5F5F7]">{agent.name}</div>
                        <div className="flex gap-1 mt-0.5">{(agent.capabilityTags||[]).slice(0,2).map(tag => <span key={tag} className="text-[11px] text-[#86868B] dark:text-[#98989D] bg-[#E5E5E7] dark:bg-[#3A3A3C] rounded-md px-1.5 py-0.5 leading-none">{tag}</span>)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </motion.div>
          )}

          {/* ── 群聊 Tab ── */}
          {tab === "groups" && (
            <motion.div key="groups" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="px-3 pb-16">
              {groupSessions.filter(s => searchFilter(s.title||"")).length === 0 ? (
                <div className="text-center text-[13px] text-[#C7C7CC] dark:text-[#636366] py-12">
                  <div className="text-4xl mb-3">👥</div>
                  {search ? "无匹配群聊" : "暂无群聊"}
                  <div className="text-[11px] mt-1">{search ? "" : "点击下方按钮创建一个"}</div>
                </div>
              ) : (
                groupSessions.filter(s => searchFilter(s.title||"")).map(s => {
                  const isActive = activeSessionId === s.id;
                  return (
                    <div key={s.id} onClick={() => setActiveSession(s.id)}
                      className={cn("group relative flex items-center gap-3 px-2 py-2 rounded-[10px] cursor-pointer transition-all duration-150 hover-lift", isActive && "bg-white dark:bg-[#2C2C2E] shadow-sm")}>
                      {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#007AFF] rounded-full" />}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 bg-[#E5E5E7] dark:bg-[#3A3A3C]">
                        <span className="text-sm font-bold text-[#86868B]">#</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-medium truncate dark:text-[#F5F5F7]">{s.title||"群聊"}</div>
                        <div className="text-[12px] text-[#86868B] dark:text-[#98989D]">{s.agentCount>0 ? `群聊 · ${s.agentCount}人` : "群聊"}</div>
                      </div>
                      <button onClick={e=>handleDeleteSession(e,s.id)} className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-50/20 text-[#C7C7CC] hover:text-[#FF3B30]">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  );
                })
              )}
            </motion.div>
          )}

          {/* ── 话题 Tab ── */}
          {tab === "topics" && (
            <motion.div key="topics" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="px-3 pb-16">
              {!selectedContactId ? (
                <div className="text-center text-[13px] text-[#C7C7CC] dark:text-[#636366] py-12">
                  <div className="text-4xl mb-3">💬</div>
                  请先选择一个助手
                  <div className="text-[11px] mt-1 mb-4">话题需要与助手关联</div>
                  <button onClick={() => setTab("agents")} className="text-[12px] text-[#007AFF] hover:underline">去选择助手 →</button>
                </div>
              ) : (
                <>
                  {/* Current agent bar */}
                  <div className="flex items-center gap-2 mb-2 px-2 py-1">
                    <span className="text-[11px] text-[#86868B] dark:text-[#98989D]">助手：</span>
                    <span className="text-[12px] font-medium truncate dark:text-[#F5F5F7]">{selectedAgent?.name || selectedContactId.slice(0,8)}</span>
                    <button onClick={() => setSelectedContact(null)} className="ml-auto text-[11px] text-[#C7C7CC] hover:text-[#FF3B30] transition-colors">✕</button>
                  </div>

                  {agentTopics.filter(s => searchFilter(s.title||"")).length === 0 ? (
                    <div className="text-center text-[13px] text-[#C7C7CC] dark:text-[#636366] py-12">
                      <div className="text-4xl mb-3">💬</div>
                      暂无话题
                      <div className="text-[11px] mt-1">点击下方按钮创建</div>
                    </div>
                  ) : (
                    agentTopics.filter(s => searchFilter(s.title||"")).map(s => {
                      const isActive = activeSessionId === s.id;
                      return (
                        <div key={s.id} onClick={() => setActiveSession(s.id)}
                          className={cn("group relative flex items-center gap-3 px-2 py-2 rounded-[10px] cursor-pointer transition-all duration-150 hover-lift", isActive && "bg-white dark:bg-[#2C2C2E] shadow-sm")}>
                          {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#007AFF] rounded-full" />}
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm shrink-0 bg-gradient-to-br from-blue-400 to-blue-500">
                            <span className="text-white text-[11px] font-semibold">@</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-medium truncate dark:text-[#F5F5F7]">{s.title||"新对话"}</div>
                            <div className="text-[12px] text-[#86868B] dark:text-[#98989D]">单聊</div>
                          </div>
                          <button onClick={e=>handleDeleteSession(e,s.id)} className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-50/20 text-[#C7C7CC] hover:text-[#FF3B30]">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>

      {/* Bottom button */}
      <div className="p-3 shrink-0">
        <button
          onClick={bottomBtn.onClick}
          disabled={bottomBtn.disabled}
          className={cn(
            "w-full py-2.5 rounded-[10px] text-[15px] font-medium transition-all duration-150 active:scale-[0.98]",
            bottomBtn.disabled
              ? "bg-[#C7C7CC] dark:bg-[#3A3A3C] text-white dark:text-[#636366] cursor-not-allowed"
              : "bg-[#007AFF] text-white hover:bg-[#0066D6]"
          )}
        >
          {bottomBtn.label}
        </button>
      </div>

      {/* Agent Editor */}
      <AgentEditor open={editorOpen} onClose={() => setEditorOpen(false)} editAgent={editingAgent} />

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-white dark:bg-[#2C2C2E] rounded-xl shadow-lg border border-[#E5E5E7] dark:border-[#38383A] py-1 w-36 animate-fade-in" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={handleEditAgent} className="w-full text-left px-4 py-2.5 text-[14px] dark:text-[#F5F5F7] hover:bg-[#F5F5F7] dark:hover:bg-[#3A3A3C] transition-colors">编辑</button>
          <button onClick={handleDeleteAgent} className="w-full text-left px-4 py-2.5 text-[14px] text-[#FF3B30] hover:bg-red-50 dark:hover:bg-red-50/20 transition-colors">删除</button>
        </div>
      )}
    </div>
  );
}
