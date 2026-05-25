"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatStore } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { API_BASE } from "@/lib/constants";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const sessions = useChatStore((s) => s.sessions);
  const setSessions = useChatStore((s) => s.setSessions);
  const pendingSend = useChatStore((s) => s.pendingSend);
  const setPendingSend = useChatStore((s) => s.setPendingSend);
  const agents = useAgentStore((s) => s.agents);
  const { sendMessage, sendModify } = useWebSocket(activeSessionId);
  const [showMenu, setShowMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");

  // Handle pending send from PlanCard selection
  useEffect(() => {
    if (pendingSend) {
      sendMessage(pendingSend);
      setPendingSend(null);
    }
  }, [pendingSend, sendMessage, setPendingSend]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isConnected = connectionStatus === "connected";

  const [sessionAgents, setSessionAgents] = useState<string[]>([]);
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/sessions/${activeSessionId}`).then(r => r.json()).then(data => {
      if (!cancelled) setSessionAgents((data.agents || []).map((a: {agent_id:string}) => a.agent_id));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeSessionId]);

  const handleRename = async () => {
    if (!activeSessionId || !title.trim()) return;
    setEditingTitle(false);
    setSessions(sessions.map(s => s.id === activeSessionId ? {...s, title: title.trim()} : s));
  };

  const handleAddMember = async (agentId: string) => {
    if (!activeSessionId) return;
    await fetch(`${API_BASE}/api/sessions/${activeSessionId}/agents/${agentId}`, {method:"POST"});
    setSessionAgents([...sessionAgents, agentId]);
    refreshSessions();
  };

  const handleRemoveMember = async (agentId: string) => {
    if (!activeSessionId) return;
    await fetch(`${API_BASE}/api/sessions/${activeSessionId}/agents/${agentId}`, {method:"DELETE"});
    setSessionAgents(sessionAgents.filter(id => id !== agentId));
    refreshSessions();
  };

  const refreshSessions = async () => {
    const r = await fetch(`${API_BASE}/api/sessions`);
    if (r.ok) setSessions(await r.json());
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white min-w-[400px]">
      <div className="glass shrink-0 px-6 flex items-center h-[52px] border-b border-[#E5E5E7]/50">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input autoFocus value={title} onChange={e=>setTitle(e.target.value)}
              onBlur={handleRename} onKeyDown={e=>{if(e.key==="Enter")handleRename();if(e.key==="Escape")setEditingTitle(false);}}
              className="text-[17px] font-semibold bg-transparent border-0 outline-none border-b-2 border-[#007AFF] w-full" />
          ) : (
            <h2 className="text-[17px] font-semibold text-[#1D1D1F] tracking-tight cursor-pointer hover:text-[#007AFF] transition-colors"
              onClick={()=>{setTitle(activeSession?.title||"");setEditingTitle(true);}}>
              {activeSession?.title || "聊天"}
            </h2>
          )}
          {activeSession && (
            <p className="text-[12px] text-[#86868B] mt-0.5">
              {activeSession.type === "group" ? `群聊 · ${sessionAgents.length} 人` : "单聊"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-[#34C759] animate-pulse-blue" : connectionStatus==="connecting"?"bg-[#FF9F0A] animate-pulse":"bg-[#C7C7CC]")} />
          <span className="text-[12px] text-[#86868B]">{isConnected?"在线":connectionStatus==="connecting"?"连接中":"离线"}</span>
          {activeSession?.type === "group" && (
            <div className="relative">
              <button onClick={()=>setShowMenu(!showMenu)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#F5F5F7] transition-colors text-[#86868B]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-[#E5E5E7] py-1 z-50 animate-fade-in"
                  onClick={()=>setShowMenu(false)}>
                  <button onClick={()=>setShowMembers(true)}
                    className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[#F5F5F7] transition-colors">管理成员</button>
                  <button onClick={()=>{setTitle(activeSession?.title||"");setEditingTitle(true);}}
                    className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[#F5F5F7] transition-colors">重命名</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MessageList onModify={sendModify} />
      <MessageInput onSend={sendMessage} disabled={!isConnected} />

      {showMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-fade-in" onClick={()=>setShowMembers(false)}>
          <div className="bg-white rounded-2xl shadow-lg p-6 w-[360px] animate-spring" onClick={e=>e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold mb-4">群成员</h3>
            <div className="space-y-2 mb-4">
              {sessionAgents.map(aid => {
                const agent = agents.find(a => a.id === aid);
                return (
                  <div key={aid} className="flex items-center justify-between py-1.5">
                    <span className="text-[14px]">{agent?.name || aid.slice(0,8)}</span>
                    {sessionAgents.length > 1 && (
                      <button onClick={()=>handleRemoveMember(aid)}
                        className="text-[12px] text-[#FF3B30] hover:bg-red-50 px-3 py-1 rounded-lg transition-colors">移除</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[#E5E5E7] pt-4">
              <p className="text-[12px] text-[#86868B] mb-2">添加 Agent</p>
              <div className="space-y-1">
                {agents.filter(a => !sessionAgents.includes(a.id)).map(a => (
                  <button key={a.id} onClick={()=>handleAddMember(a.id)}
                    className="w-full text-left px-3 py-2 rounded-[10px] text-[14px] hover:bg-[#F5F5F7] transition-colors flex items-center gap-2">
                    <span className="text-lg">{a.adapterType==="deepseek"?"🧠":a.adapterType==="anthropic"?"✨":"🔧"}</span>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={()=>setShowMembers(false)}
              className="w-full mt-4 py-2.5 rounded-xl bg-[#007AFF] text-white text-[14px] font-medium hover:bg-[#0066D6] transition-colors">完成</button>
          </div>
        </div>
      )}
    </div>
  );
}
