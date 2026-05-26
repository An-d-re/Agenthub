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
  const { sendMessage, sendModify, sendPlanAction, sendSessionControl } = useWebSocket(activeSessionId);

  // 连接状态横幅
  useEffect(() => {
    if (connectionStatus === "disconnected") {
      setConnBanner("reconnecting");
    } else if (connectionStatus === "connected" && connBanner === "reconnecting") {
      setConnBanner("restored");
      const t = setTimeout(() => setConnBanner(null), 3000);
      return () => clearTimeout(t);
    }
  }, [connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showMenu, setShowMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [connBanner, setConnBanner] = useState<"reconnecting"|"restored"|null>(null);

  const handleSend = (content: string, quoteMessageId?: string) => {
    sendMessage(content, quoteMessageId);
  };

  const handleRegenerate = (agentMessageId: string) => {
    if (!activeSessionId) return;
    const msgs = useChatStore.getState().messages[activeSessionId] || [];
    const agentIdx = msgs.findIndex(m => m.id === agentMessageId);
    if (agentIdx <= 0) return;
    for (let i = agentIdx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        sendMessage(msgs[i].content);
        return;
      }
    }
  };

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
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#1C1C1E] min-w-[400px]">
      <div className="glass shrink-0 px-6 flex items-center h-[52px] border-b border-[#E5E5E7]/50 dark:border-[#38383A]/50">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input autoFocus value={title} onChange={e=>setTitle(e.target.value)}
              onBlur={handleRename} onKeyDown={e=>{if(e.key==="Enter")handleRename();if(e.key==="Escape")setEditingTitle(false);}}
              className="text-[17px] font-semibold bg-transparent border-0 outline-none border-b-2 border-[var(--accent)] w-full" />
          ) : (
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)] dark:text-[var(--bg-secondary)] tracking-tight cursor-pointer hover:text-[var(--accent)] transition-colors"
              onClick={()=>{setTitle(activeSession?.title||"");setEditingTitle(true);}}>
              {activeSession?.title || "聊天"}
            </h2>
          )}
          {activeSession && (
            <p className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">
              {activeSession.type === "group" ? `群聊 · ${sessionAgents.length} 人` : "单聊"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-[var(--success)] animate-pulse-blue" : connectionStatus==="connecting"?"bg-[var(--warning)] animate-pulse":"bg-[#C7C7CC]")} />
          <span className="text-[12px] text-[var(--text-secondary)]">{isConnected?"在线":connectionStatus==="connecting"?"连接中":"离线"}</span>
          {activeSession?.type === "group" && (
            <button
              onClick={() => sendSessionControl("stop")}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--danger)] hover:bg-red-50 transition-colors"
              title="停止执行"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
            </button>
          )}
          {activeSession?.type === "group" && (
            <div className="relative">
              <button onClick={()=>setShowMenu(!showMenu)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-secondary)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[var(--bg-secondary)] rounded-xl shadow-lg border border-[var(--border)] dark:border-[#38383A] py-1 z-50 animate-fade-in"
                  onClick={()=>setShowMenu(false)}>
                  <button onClick={()=>setShowMembers(true)}
                    className="w-full text-left px-4 py-2.5 text-[14px] dark:text-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] dark:hover:bg-[#3A3A3C] transition-colors">管理成员</button>
                  <button onClick={()=>{setTitle(activeSession?.title||"");setEditingTitle(true);}}
                    className="w-full text-left px-4 py-2.5 text-[14px] dark:text-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] dark:hover:bg-[#3A3A3C] transition-colors">重命名</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 连接状态横幅 */}
      {connBanner && (
        <div className={cn(
          "text-center text-[12px] py-1.5 font-medium transition-all",
          connBanner === "reconnecting" ? "bg-[var(--warning)]/10 text-[var(--warning)]" : "bg-[var(--success)]/10 text-[var(--success)]"
        )}>
          {connBanner === "reconnecting" ? "⚠️ 连接断开，正在重连…" : "✅ 已重新连接"}
        </div>
      )}

      <MessageList onModify={sendModify} onPlanAction={sendPlanAction} onRegenerate={handleRegenerate} />
      <MessageInput onSend={handleSend} disabled={!isConnected} />

      {showMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-fade-in" onClick={()=>setShowMembers(false)}>
          <div className="bg-white dark:bg-[var(--bg-secondary)] rounded-2xl shadow-lg p-6 w-[360px] animate-spring" onClick={e=>e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold dark:text-[var(--bg-secondary)] mb-4">群成员</h3>
            <div className="space-y-2 mb-4">
              {sessionAgents.map(aid => {
                const agent = agents.find(a => a.id === aid);
                return (
                  <div key={aid} className="flex items-center justify-between py-1.5">
                    <span className="text-[14px] dark:text-[var(--bg-secondary)]">{agent?.name || aid.slice(0,8)}</span>
                    {sessionAgents.length > 1 && (
                      <button onClick={()=>handleRemoveMember(aid)}
                        className="text-[12px] text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-50/20 px-3 py-1 rounded-lg transition-colors">移除</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[var(--border)] dark:border-[#38383A] pt-4">
              <p className="text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2">添加 Agent</p>
              <div className="space-y-1">
                {agents.filter(a => !sessionAgents.includes(a.id)).map(a => (
                  <button key={a.id} onClick={()=>handleAddMember(a.id)}
                    className="w-full text-left px-3 py-2 rounded-[12px] text-[14px] dark:text-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)] dark:hover:bg-[#3A3A3C] transition-colors flex items-center gap-2">
                    <span className="text-lg">{a.adapterType==="deepseek"?"🧠":a.adapterType==="anthropic"?"✨":"🔧"}</span>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={()=>setShowMembers(false)}
              className="w-full mt-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[14px] font-medium hover:bg-[var(--accent-hover)] transition-colors">完成</button>
          </div>
        </div>
      )}
    </div>
  );
}
