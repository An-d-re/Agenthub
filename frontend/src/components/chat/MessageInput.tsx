"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface Props { onSend: (content: string) => void; disabled?: boolean; }

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const agents = useAgentStore(s => s.agents);
  const [mention, setMention] = useState<{active: boolean; query: string; idx: number}>({active: false, query: "", idx: -1});
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionId = useChatStore(s => s.activeSessionId);

  const filteredAgents = mention.active
    ? agents.filter(a => a.name.toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  useEffect(() => { setHighlightIdx(0); }, [mention.query]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const pos = e.target.selectionStart || 0;
    const before = value.slice(0, pos);
    const m = before.match(/@([^\s@]*)$/);
    if (m) {
      setMention({ active: true, query: m[1], idx: pos - m[0].length });
    } else {
      setMention({ active: false, query: "", idx: -1 });
    }
  };

  const selectAgent = useCallback((agentName: string) => {
    if (mention.idx < 0) return;
    const before = text.slice(0, mention.idx);
    const after = text.slice(mention.idx + 1 + mention.query.length);
    const newText = before + `@${agentName} ` + after;
    setText(newText);
    setMention({ active: false, query: "", idx: -1 });
    textareaRef.current?.focus();
  }, [text, mention.idx, mention.query]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    setMention({ active: false, query: "", idx: -1 });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSessionId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await fetch(`${API_BASE}/api/sessions/${activeSessionId}/upload`, {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("文件上传失败:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mention.active && filteredAgents.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filteredAgents.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectAgent(filteredAgents[highlightIdx]?.name || filteredAgents[0]?.name || "");
        return;
      }
      if (e.key === "Escape") { setMention({ active: false, query: "", idx: -1 }); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !mention.active) { e.preventDefault(); send(); }
  };

  return (
    <div className="px-4 pb-4 pt-2 shrink-0 relative">
      <div className="flex items-end gap-2 bg-[#F5F5F7] rounded-[24px] px-5 py-2 border border-transparent focus-within:border-[#007AFF]/20 focus-within:bg-white transition-all duration-200">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
          accept="image/*,.txt,.md,.py,.js,.ts,.tsx,.jsx,.json,.yml,.yaml,.html,.css,.sql,.sh,.pdf"
        />
        <button
          className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868B] hover:text-[#007AFF] hover:bg-[#007AFF]/10 transition-colors shrink-0 mb-0.5"
          disabled={disabled || uploading || !activeSessionId}
          onClick={() => fileInputRef.current?.click()}
          title="上传文件"
        >
          {uploading ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={text} onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，@ 选择 Agent"
          className="flex-1 min-h-[24px] max-h-[120px] resize-none bg-transparent border-0 outline-none text-[15px] placeholder:text-[#C7C7CC] leading-relaxed py-1.5"
          rows={1} disabled={disabled}
        />
        <button
          onClick={send}
          disabled={disabled || !text.trim()}
          className="w-8 h-8 rounded-full bg-[#007AFF] text-white flex items-center justify-center transition-all duration-150 hover:bg-[#0066D6] active:scale-90 disabled:opacity-30 disabled:active:scale-100 shrink-0 mb-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>

      {/* @Mention dropdown */}
      {mention.active && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-white rounded-xl shadow-lg border border-[#E5E5E7] max-h-[200px] overflow-y-auto z-50 animate-fade-in">
          {filteredAgents.map((agent, i) => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent.name)}
              onMouseEnter={() => setHighlightIdx(i)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                i === highlightIdx ? "bg-[#007AFF]/10" : "hover:bg-[#F5F5F7]"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-sm shrink-0",
                agent.adapterType === "deepseek" ? "from-purple-500 to-indigo-500" :
                agent.adapterType === "anthropic" ? "from-amber-400 to-orange-500" :
                "from-blue-400 to-cyan-500"
              )}>
                {agent.roleType === "custom" && agent.avatarUrl
                  ? <img src={agent.avatarUrl} className="w-8 h-8 rounded-full object-cover" alt="" />
                  : agent.adapterType === "deepseek" ? "🧠" : agent.adapterType === "anthropic" ? "✨" : "🔧"}
              </div>
              <div>
                <div className="text-[14px] font-medium">{agent.name}</div>
                <div className="text-[11px] text-[#86868B]">{agent.adapterType}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="text-[11px] text-[#C7C7CC] text-center mt-1.5">Enter 发送 · Shift+Enter 换行 · @ 选择 Agent</div>
    </div>
  );
}
