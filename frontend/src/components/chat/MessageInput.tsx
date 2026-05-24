"use client";

import { useState } from "react";

interface Props { onSend: (content: string) => void; disabled?: boolean; }

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="px-4 pb-4 pt-2 shrink-0">
      <div className="flex items-end gap-2 bg-[#F5F5F7] rounded-[24px] px-5 py-2 border border-transparent focus-within:border-[#007AFF]/20 focus-within:bg-white transition-all duration-200">
        {/* + button */}
        <button className="w-8 h-8 rounded-full flex items-center justify-center text-[#007AFF] hover:bg-[#007AFF]/10 transition-colors shrink-0 mb-0.5" disabled={disabled}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
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
      <div className="text-[11px] text-[#C7C7CC] text-center mt-1.5">Enter 发送 · Shift+Enter 换行</div>
    </div>
  );
}
