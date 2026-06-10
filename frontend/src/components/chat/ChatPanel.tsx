"use client";

import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatStore, type TaskItem } from "@/stores/chatStore";
import { useAgentStore } from "@/stores/agentStore";
import { API_BASE, EMPTY_ARRAY } from "@/lib/constants";
import { AgentIcon } from "@/lib/agentIcons";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { AgentEditor } from "@/components/contacts/AgentEditor";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const sessions = useChatStore((s) => s.sessions);
  const setSessions = useChatStore((s) => s.setSessions);
  const pendingSend = useChatStore((s) => s.pendingSend);
  const setPendingSend = useChatStore((s) => s.setPendingSend);
  const agents = useAgentStore((s) => s.agents);
  const { sendMessage, sendModify, sendRegenerate, sendPlanAction, sendSessionControl } = useWebSocket(activeSessionId);

  // 连接状态横幅（仅在有活跃会话时显示）
  useEffect(() => {
    if (!activeSessionId) { setConnBanner(null); return; }
    if (connectionStatus === "disconnected") {
      setConnBanner("reconnecting");
    } else if (connectionStatus === "connected" && connBanner === "reconnecting") {
      setConnBanner("restored");
      const t = setTimeout(() => setConnBanner(null), 3000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- adding connBanner causes infinite loop
  }, [connectionStatus, activeSessionId]);
  const [showMenu, setShowMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [connBanner, setConnBanner] = useState<"reconnecting"|"restored"|null>(null);
  const [messageSearch, setMessageSearch] = useState("");

  const [sendError, setSendError] = useState(false);

  // 成员管理内联编辑 Prompt
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  // Agent 搜索 + 新建
  const [searchQuery, setSearchQuery] = useState("");
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSend = (content: string, quoteMessageId?: string) => {
    const ok = sendMessage(content, quoteMessageId);
    if (!ok) {
      setSendError(true);
      setTimeout(() => setSendError(false), 4000);
    }
  };

  const handleRegenerate = (agentMessageId: string) => {
    sendRegenerate(agentMessageId);
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

  // Agent 思考中：最后一条消息来自用户 或 有正在执行/审查的任务
  const messages = useChatStore(s => activeSessionId ? (s.messages[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY);
  const tasks = useChatStore(s => activeSessionId ? (s.tasks[activeSessionId] || EMPTY_ARRAY) : EMPTY_ARRAY);
  const lastMsg = messages[messages.length - 1];
  const hasRunningTasks = tasks.some(t => t.status === "running" || t.status === "reviewing");
  const isThinking = lastMsg?.role === "user" || hasRunningTasks;
  const [thinkingTimedOut, setThinkingTimedOut] = useState(false);

  // isThinking 超时防护：超过 60s 无回复自动重置
  useEffect(() => {
    if (!isThinking) { setThinkingTimedOut(false); return; }
    const t = setTimeout(() => setThinkingTimedOut(true), 60000);
    return () => clearTimeout(t);
  }, [isThinking, messages.length]);

  // isThinking 超时时视为未在思考
  const effectiveThinking = isThinking && !thinkingTimedOut;

  const sessionAgents = useChatStore(s => s.sessionAgentIds[activeSessionId || ""] ?? EMPTY_ARRAY);
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/sessions/${activeSessionId}`).then(r => r.json()).then(data => {
      if (cancelled) return;
      const store = useChatStore.getState();

      // 恢复 Agent 列表
      const ids = (data.agents || []).map((a: {agent_id:string}) => a.agent_id);
      store.initSessionAgents(activeSessionId, ids);

      // 恢复任务状态（页面刷新/切换会话后从 DB 重新加载）
      const planTasks = data.plan?.tasks;
      if (planTasks && planTasks.length > 0) {
        // 切回已访问过的会话时也要用 API 状态覆盖旧任务（防止 running/reviewing 残留）
        store.setTasks(activeSessionId, planTasks.map((t: Record<string,unknown>) => ({
          taskId: t.task_id as string,
          title: t.title as string,
          status: t.status as TaskItem["status"],
          agentId: t.assigned_agent_id as string,
          startedAt: t.started_at as string,
          completedAt: t.completed_at as string,
        })));

        // 恢复 confirmedPlan（不限 phase，已完成会话也需展示 DAG）
        const dagTasks = planTasks.map((t: Record<string,unknown>) => ({
          id: t.task_id as string,
          title: t.title as string,
          description: "",
          dependencies: [] as string[],
          required_capability: "",
          executor_type: "existing" as const,
          agent_id: t.assigned_agent_id as string,
          agent_name: "",
          match_reason: "",
          selected_agent_id: t.assigned_agent_id as string,
          db_id: t.task_id as string,
        }));
        store.setConfirmedPlan(activeSessionId, { tasks: dagTasks, hint: "" });
      }

      // 恢复 plan 方案对比卡片（不限 phase）
      if (data.plan?.approaches && data.plan.approaches.length > 0) {
        store.setPlan(activeSessionId, {
          messageId: "",
          approaches: data.plan.approaches,
          selectedApproach: data.plan.selected_approach,
        });
      }
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
    useChatStore.getState().addSessionAgent(activeSessionId, agentId);
    refreshSessions();
  };

  const handleRemoveMember = async (agentId: string) => {
    if (!activeSessionId) return;
    await fetch(`${API_BASE}/api/sessions/${activeSessionId}/agents/${agentId}`, {method:"DELETE"});
    useChatStore.getState().removeSessionAgent(activeSessionId, agentId);
    refreshSessions();
  };

  const handleSavePrompt = async (agentId: string) => {
    setSavingPrompt(true);
    try {
      const agent = agents.find(a => a.id === agentId);
      if (!agent) return;
      await fetch(`${API_BASE}/api/agents/${agentId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agent.name,
          role_type: agent.roleType,
          adapter_type: agent.adapterType,
          system_prompt: editingPrompt,
          skills: [],
          capability_tags: agent.capabilityTags || [],
          avatar_url: agent.avatarUrl,
        }),
      });
      useAgentStore.getState().setAgents(agents.map(a => a.id === agentId ? { ...a, systemPrompt: editingPrompt } : a));
      setExpandedPromptId(null);
    } catch { /* ignore */ }
    finally { setSavingPrompt(false); }
  };

  const handleAgentCreated = async (agentId: string) => {
    if (!activeSessionId) return;
    await fetch(`${API_BASE}/api/sessions/${activeSessionId}/agents/${agentId}`, { method: "POST" });
    useChatStore.getState().addSessionAgent(activeSessionId, agentId);
    refreshSessions();
  };

  // 过滤可添加的 Agent：不在群中、匹配搜索词（名称或能力标签）
  const availableAgents = agents.filter(a => !sessionAgents.includes(a.id));
  const filteredAgents = searchQuery.trim()
    ? availableAgents.filter(a => {
        const q = searchQuery.trim().toLowerCase();
        return a.name.toLowerCase().includes(q)
          || (a.capabilityTags || []).some(t => t.toLowerCase().includes(q));
      })
    : availableAgents;

  const refreshSessions = async () => {
    const r = await fetch(`${API_BASE}/api/sessions`);
    if (r.ok) setSessions(await r.json());
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] min-w-[400px]">
      <div className="glass shrink-0 px-6 flex items-center h-[56px] pt-2 border-b border-[var(--border)] relative z-10">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input autoFocus value={title} onChange={e=>setTitle(e.target.value)}
              onBlur={handleRename} onKeyDown={e=>{if(e.key==="Enter")handleRename();if(e.key==="Escape")setEditingTitle(false);}}
              className="text-[17px] font-semibold bg-transparent border-0 outline-none border-b-2 border-[var(--accent)] w-full" />
          ) : (
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)] dark:text-[var(--text-primary)] tracking-tight cursor-pointer hover:text-[var(--accent)] transition-colors"
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
          {activeSessionId && (
            <>
              <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-[var(--success)] animate-pulse-blue" : connectionStatus==="connecting"?"bg-[var(--warning)] animate-pulse":"bg-[var(--text-tertiary)]")} />
              <span className="text-[12px] text-[var(--text-secondary)]">{isConnected?"在线":connectionStatus==="connecting"?"连接中":"离线"}</span>
            </>
          )}
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
                <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border)] py-1 z-[100] animate-fade-in"
                  onClick={()=>setShowMenu(false)}>
                  <button onClick={()=>setShowMembers(true)}
                    className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[var(--bg-secondary)] transition-colors">管理成员</button>
                  <button onClick={()=>{setTitle(activeSession?.title||"");setEditingTitle(true);}}
                    className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[var(--bg-secondary)] transition-colors">重命名</button>
                  <button onClick={() => {
                    if (activeSessionId) {
                      const a = document.createElement("a");
                      a.href = `${API_BASE}/api/sessions/${activeSessionId}/export`;
                      a.download = "";
                      a.click();
                    }
                  }}
                    className="w-full text-left px-4 py-2.5 text-[14px] hover:bg-[var(--bg-secondary)] transition-colors">导出对话</button>
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
          {connBanner === "reconnecting" ? "连接断开，正在重连…" : "已重新连接"}
        </div>
      )}

      {/* 消息搜索 */}
      {messages.length > 0 && (
        <div className="px-4 pt-2">
          <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-xl px-3 py-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              className="flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:text-[var(--text-secondary)]"
              placeholder="搜索消息内容…"
              value={messageSearch}
              onChange={e => setMessageSearch(e.target.value)}
            />
            {messageSearch && (
              <button onClick={() => setMessageSearch("")} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 任务执行进度 */}
      {hasRunningTasks && (
        <div className="px-4 pt-1 animate-fade-in">
          <div className="flex items-center gap-3 bg-[var(--accent)]/5 border border-[var(--accent)]/10 rounded-xl px-4 py-2.5">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] text-[var(--accent)] font-medium">
                {tasks.filter(t => t.status === "running").length} 个任务执行中
                {tasks.filter(t => t.status === "reviewing").length > 0 && ` · ${tasks.filter(t => t.status === "reviewing").length} 个审查中`}
              </span>
            </div>
            <div className="flex gap-1 shrink-0">
              {tasks.filter(t => t.status !== "done" && t.status !== "pending").map(t => (
                <div
                  key={t.taskId}
                  className="w-5 h-1 rounded-full transition-colors duration-300"
                  style={{ backgroundColor: t.status === "running" ? "var(--accent)" : t.status === "reviewing" ? "var(--warning)" : "var(--text-tertiary)" }}
                  title={`${t.title}: ${t.status}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <MessageList onModify={sendModify} onPlanAction={sendPlanAction} onRegenerate={handleRegenerate} searchTerm={messageSearch} />
      {sendError && (
        <div className="text-center text-[13px] text-[var(--danger)] py-1">发送失败，正在重连…</div>
      )}
      <MessageInput onSend={handleSend} disabled={false} isThinking={effectiveThinking} onStop={() => sendSessionControl("stop")} />

      {showMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-fade-in" onClick={()=>{setShowMembers(false); setExpandedPromptId(null); setSearchQuery("");}}>
          <div className="bg-[var(--bg-primary)] rounded-2xl shadow-lg p-6 w-[400px] max-h-[80vh] overflow-y-auto animate-spring" onClick={e=>e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold mb-1">群成员</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mb-4">点击名称可编辑 Agent 的 Prompt</p>
            <div className="space-y-1 mb-4">
              {sessionAgents.map(aid => {
                const agent = agents.find(a => a.id === aid);
                const isExpanded = expandedPromptId === aid;
                return (
                  <div key={aid}>
                    <div className="flex items-center justify-between py-1.5">
                      <button
                        onClick={() => {
                          if (isExpanded) { setExpandedPromptId(null); return; }
                          setExpandedPromptId(aid);
                          setEditingPrompt(agent?.systemPrompt || "");
                        }}
                        className="text-[14px] font-medium hover:text-[var(--accent)] transition-colors text-left flex items-center gap-1.5 group"
                      >
                        {agent?.name || aid.slice(0,8)}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)]"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {sessionAgents.length > 1 && agent?.roleType !== "system" && (
                        <button onClick={()=>handleRemoveMember(aid)}
                          className="text-[12px] text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-50/20 px-3 py-1 rounded-lg transition-colors">移除</button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mb-2 pl-1">
                        <textarea
                          value={editingPrompt}
                          onChange={e => setEditingPrompt(e.target.value.slice(0, 2000))}
                          className="w-full px-3 py-2 rounded-[10px] bg-[var(--bg-secondary)] border border-[var(--border)] outline-none text-[13px] resize-y min-h-[80px] leading-relaxed focus:ring-2 focus:ring-[var(--accent)]/20"
                          placeholder="输入 System Prompt…"
                          autoFocus
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[11px] text-[var(--text-tertiary)]">{editingPrompt.length}/2000</span>
                          <div className="flex gap-2">
                            <button onClick={() => setExpandedPromptId(null)}
                              className="text-[12px] px-3 py-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors">取消</button>
                            <button onClick={() => handleSavePrompt(aid)} disabled={savingPrompt}
                              className="text-[12px] px-3 py-1 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50">
                              {savingPrompt ? "保存中…" : "保存"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[var(--border)] pt-4">
              <p className="text-[12px] text-[var(--text-secondary)] mb-2">添加 Agent</p>
              <div className="relative">
                <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-xl px-3 py-2 ring-1 ring-[var(--border)] focus-within:ring-[var(--accent)]/30 transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <input
                    ref={searchInputRef}
                    className="flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:text-[var(--text-tertiary)]"
                    placeholder="搜索 Agent 名称或能力标签…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
                <div className="mt-1 max-h-[160px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] shadow-sm">
                  {filteredAgents.length > 0 ? (
                    filteredAgents.map(a => (
                      <button key={a.id} onClick={() => { handleAddMember(a.id); setSearchQuery(""); }}
                        className="w-full text-left px-3 py-2 text-[14px] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2 first:rounded-t-xl last:rounded-b-xl">
                        <span><AgentIcon adapterType={a.adapterType} size={18} /></span>
                        <div className="flex-1 min-w-0">
                          <span>{a.name}</span>
                          {(a.capabilityTags || []).length > 0 && (
                            <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">{(a.capabilityTags || []).slice(0, 3).join(" · ")}</span>
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-[13px] text-[var(--text-tertiary)] text-center">
                      {availableAgents.length === 0 ? "所有 Agent 已在群中" : "无匹配的 Agent"}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setShowAgentEditor(true)}
                className="w-full mt-2 py-2 rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors flex items-center justify-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                新建 Agent
              </button>
            </div>
            <button onClick={()=>{setShowMembers(false); setExpandedPromptId(null); setSearchQuery("");}}
              className="w-full mt-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[14px] font-medium hover:bg-[var(--accent-hover)] transition-colors">完成</button>
          </div>
        </div>
      )}

      <AgentEditor
        open={showAgentEditor}
        onClose={() => setShowAgentEditor(false)}
        onCreated={handleAgentCreated}
      />
    </div>
  );
}
