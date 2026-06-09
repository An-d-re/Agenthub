"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface Props {
  code: string;
  language: string;
  messageId: string;
  onModify: (messageId: string, startLine: number, endLine: number, instruction: string) => void;
}

export function CodeBlock({ code, language, messageId, onModify }: Props) {
  const lines = code.split("\n");
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLineClick = (lineIdx: number) => {
    if (selStart === null) {
      setSelStart(lineIdx);
      setSelEnd(lineIdx);
    } else if (selStart === lineIdx && selEnd === lineIdx) {
      setSelStart(null);
      setSelEnd(null);
    } else {
      const start = Math.min(selStart, lineIdx);
      const end = Math.max(selStart, lineIdx);
      setSelStart(start);
      setSelEnd(end);
    }
  };

  useEffect(() => {
    if (selStart !== null && selEnd !== null && selStart !== selEnd) {
      inputRef.current?.focus();
    }
  }, [selStart, selEnd]);

  const handleSendModify = () => {
    if (selStart === null || selEnd === null || !instruction.trim()) return;
    onModify(messageId, selStart + 1, selEnd + 1, instruction.trim());
    setInstruction("");
    setSelStart(null);
    setSelEnd(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendModify();
    }
    if (e.key === "Escape") {
      setSelStart(null);
      setSelEnd(null);
      setInstruction("");
    }
  };

  const isSelected = (lineIdx: number) => {
    if (selStart === null || selEnd === null) return false;
    return lineIdx >= selStart && lineIdx <= selEnd;
  };

  const selectedRange = selStart !== null && selEnd !== null && selStart !== selEnd;

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-[var(--border)] bg-[#1D1D1F] text-[var(--bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#2D2D2F] border-b border-[#3D3D3F]">
        <span className="text-[11px] text-[var(--text-secondary)] font-mono">{language || "code"}</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#6E6E70]">点击行号选择要修改的行</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-[#6E6E70] hover:text-[var(--accent)] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      {/* Code lines */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={i}
                className={cn(
                  "group cursor-pointer transition-colors",
                  isSelected(i)
                    ? "bg-[var(--accent)]/20 border-l-2 border-l-[var(--accent)]"
                    : "hover:bg-[#2D2D2F]/50 border-l-2 border-l-transparent"
                )}
              >
                <td
                  className={cn(
                    "text-right pr-3 pl-2 select-none text-[11px] w-12 font-mono align-top pt-[3px]",
                    isSelected(i) ? "text-[var(--accent)]" : "text-[#5E5E62]"
                  )}
                  onClick={() => handleLineClick(i)}
                >
                  {i + 1}
                </td>
                <td className="font-mono text-[13px] leading-5 whitespace-pre-wrap py-[3px] pr-4">
                  {line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modify input */}
      {selectedRange && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#2D2D2F] border-t border-[#3D3D3F] animate-fade-in">
          <span className="text-[11px] text-[var(--text-secondary)] shrink-0">
            修改第{selStart! + 1}-{selEnd! + 1}行:
          </span>
          <input
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述修改内容…"
            className="flex-1 bg-[#3D3D3F] border-0 outline-none rounded-lg px-3 py-1.5 text-[13px] text-[var(--bg-secondary)] placeholder:text-[#6E6E70] focus:ring-1 focus:ring-[var(--accent)]"
          />
          <button
            onClick={handleSendModify}
            disabled={!instruction.trim()}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[12px] font-medium hover:bg-[var(--accent-hover)] disabled:opacity-30 transition-all"
          >
            发送
          </button>
          <button
            onClick={() => { setSelStart(null); setSelEnd(null); setInstruction(""); }}
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--bg-secondary)] hover:bg-[#3D3D3F] transition-colors text-[14px]"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
