"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div className="border-t border-border/50 p-4">
      <div className="flex gap-2 items-end bg-muted/50 rounded-lg border border-border/50 focus-within:border-orange-500/30 focus-within:ring-1 focus-within:ring-orange-500/20 transition-all duration-200 p-1">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... Enter 发送 / Shift+Enter 换行"
          className="min-h-[36px] max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
          rows={1}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 mb-1 mr-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
            bg-orange-500 text-white hover:bg-orange-600 active:scale-95
            disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          发送
        </button>
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground text-right">
        Enter 发送 · Shift+Enter 换行
      </div>
    </div>
  );
}
