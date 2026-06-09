"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/constants";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";
import { CodeBlock } from "./CodeBlock";
import { FileCard } from "@/components/cards/FileCard";

// ── 深度思考折叠块 ──

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1 ml-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors py-1 whitespace-nowrap select-none"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("transition-transform shrink-0", open && "rotate-90")}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium shrink-0">深度思考</span>
        <span className="text-[var(--text-tertiary)] shrink-0">({reasoning.length} 字)</span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1 rounded-xl bg-[var(--bg-secondary)] dark:bg-[#2C2C2E] border border-[var(--border)] dark:border-[#48484A] px-3 py-2 text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto"
        >
          {reasoning}
        </motion.div>
      )}
    </div>
  );
}

// ── Role badge config ──

const roleIcon = (role: string) => {
  const s = "w-3 h-3";
  switch (role) {
    case "critic": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
    case "planner": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>;
    case "coder": case "code": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    case "reviewer": case "verify": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
    case "calculate": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>;
    case "design": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>;
    case "analyze": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><line x1="16" y1="2" x2="22" y2="8"/><line x1="12" y1="12" x2="17" y2="7"/></svg>;
    case "write": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "data": return <svg className={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
    default: return null;
  }
};

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; bubble: string }> = {
  // 决策层 — 琥珀/金色
  critic:    { label: "Critic",   color: "text-[var(--accent)]",        bg: "bg-[var(--accent)]/8",     bubble: "bg-[var(--accent)]/5" },
  planner:   { label: "Planner",  color: "text-[var(--accent)]",        bg: "bg-[var(--accent)]/8",     bubble: "bg-[var(--accent)]/5" },
  // 执行层 — 中性色
  coder:     { label: "Coder",    color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  code:      { label: "编码",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  write:     { label: "写作",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  calculate: { label: "计算",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  design:    { label: "设计",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  analyze:   { label: "分析",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  data:      { label: "数据",     color: "text-[var(--text-secondary)]", bg: "bg-[var(--bg-tertiary)]", bubble: "bg-[var(--bg-tertiary)]" },
  // 审查层 — 绿色
  reviewer:  { label: "Reviewer", color: "text-[var(--success)]",       bg: "bg-[var(--success)]/8",    bubble: "bg-[var(--success)]/5" },
  verify:    { label: "验证",     color: "text-[var(--success)]",       bg: "bg-[var(--success)]/8",    bubble: "bg-[var(--success)]/5" },
};

interface Props {
  message: ChatMessage;
  index?: number;
  onModify?: (messageId: string, startLine: number, endLine: number, instruction: string) => void;
  onRegenerate?: (messageId: string) => void;
}

const bubbleSpring = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: "spring" as const, stiffness: 400, damping: 30 },
};

function QuotedPreview({ msg }: { msg: ChatMessage }) {
  const isImage = msg.messageType === "image";
  const preview = isImage ? "[图片]" : (msg.content || "").slice(0, 80);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06] border-l-2 border-[var(--accent)]/40 mb-2 text-[12px]">
      <span className="text-[var(--accent)] font-medium shrink-0">
        {msg.role === "user" ? "你" : "Agent"}
      </span>
      <span className="text-[var(--text-secondary)] truncate">{preview}{(msg.content || "").length > 80 ? "…" : ""}</span>
    </div>
  );
}

export function MessageBubble({ message, index = 0, onModify, onRegenerate }: Props) {
  const agents = useAgentStore(s => s.agents);
  const setReplyTarget = useChatStore(s => s.setReplyTarget);
  const [hovered, setHovered] = useState(false);

  const getAgentName = (agentId?: string) => {
    if (!agentId) return "Agent";
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || "Agent";
  };

  // 用 getState() 查找引用消息避免订阅整个 messages 导致 O(n) 重渲染
  let quotedMessage: ChatMessage | null = null;
  if (message.parentId && message.messageType !== "modify") {
    quotedMessage = (useChatStore.getState().messages[message.sessionId] || [])
      .find(m => m.id === message.parentId) || null;
  }

  if (message.role === "system") {
    return (
      <motion.div {...bubbleSpring} transition={{ ...bubbleSpring.transition, delay: index * 0.03 }}
        className="flex justify-center w-full my-2">
        <div className="max-w-[70%] text-center text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] bg-[var(--bg-tertiary)] dark:bg-[var(--bg-secondary)] px-5 py-2 rounded-2xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </motion.div>
    );
  }

  const isUser = message.role === "user";
  const isModify = message.messageType === "modify";
  const isImage = message.messageType === "image";
  const isFile = message.messageType === "file";

  const handleReply = () => {
    setReplyTarget({
      messageId: message.id,
      content: message.content,
      role: message.role,
      fileName: message.fileName,
    });
  };

  return (
    <motion.div {...bubbleSpring} transition={{ ...bubbleSpring.transition, delay: index * 0.03 }}
      className={cn("flex w-full mb-1.5 px-6 gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
        isUser ? "bg-[var(--accent)]/10" : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)]"
      )}>
        {isUser ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16c0-2 4-4 8-4s4 2 4 4"/></svg>
        )}
      </div>

      <div className={cn("max-w-[75%] flex flex-col relative", isUser ? "items-end" : "items-start")}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1 ml-1">
            <span className="text-[12px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{getAgentName(message.agentId)}</span>
            {message.agentRole && ROLE_CONFIG[message.agentRole] && (
              <span className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-md leading-none",
                ROLE_CONFIG[message.agentRole].bg,
                ROLE_CONFIG[message.agentRole].color,
              )}>
                {roleIcon(message.agentRole)} {ROLE_CONFIG[message.agentRole].label}
              </span>
            )}
          </div>
        )}
        {/* 引用回复按钮（悬停显示） */}
        {!isUser && hovered && (
          <div className="absolute -right-8 top-1 flex flex-col gap-1 z-10">
            <button
              onClick={handleReply}
              className="w-7 h-7 rounded-full bg-white dark:bg-[var(--bg-primary)] border border-[var(--border)] dark:border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 transition-all"
              title="引用回复"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 17 4 12 9 7" /><path d="M4 12h10a6 6 0 0 1 6 6v1" />
              </svg>
            </button>
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="w-7 h-7 rounded-full bg-white dark:bg-[var(--bg-primary)] border border-[var(--border)] dark:border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--success)] hover:border-[var(--success)]/30 transition-all"
                title="重新生成"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            )}
          </div>
        )}
        {isUser && hovered && (
          <button
            onClick={handleReply}
            className="absolute -left-8 top-1 w-7 h-7 rounded-full bg-white dark:bg-[var(--bg-primary)] border border-[var(--border)] dark:border-[var(--border)] shadow-sm flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 transition-all z-10"
            title="引用回复"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" /><path d="M4 12h10a6 6 0 0 1 6 6v1" />
            </svg>
          </button>
        )}
        {/* 深度思考（可折叠） */}
        {!isUser && message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} />
        )}
        <div className={cn(
          "rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
          isUser
            ? "bg-[var(--accent)] text-white rounded-br-[4px]"
            : isModify
              ? "bg-[#FFF3E0] dark:bg-[#3D2910] text-[var(--text-primary)] dark:text-[var(--text-primary)] rounded-bl-[4px] border border-[#FFCC80] dark:border-[#664400]"
              : message.agentRole && ROLE_CONFIG[message.agentRole]
                ? `${ROLE_CONFIG[message.agentRole].bubble} dark:bg-[var(--bg-secondary)] text-[var(--text-primary)] dark:text-[var(--text-primary)] rounded-bl-[4px]`
                : isImage || isFile
                ? "bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] text-[var(--text-primary)] dark:text-[var(--text-primary)] rounded-bl-[4px]"
                : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] text-[var(--text-primary)] dark:text-[var(--text-primary)] rounded-bl-[4px]"
        )}>
          {/* 被引用消息预览 */}
          {quotedMessage && !isImage && !isFile && (
            <QuotedPreview msg={quotedMessage} />
          )}
          {isImage && message.fileUrl ? (
            <div className="max-w-[300px]">
              <img
                src={`${API_BASE}${message.fileUrl}`}
                alt={message.fileName || "图片"}
                className="rounded-xl max-w-full h-auto cursor-pointer hover:opacity-95 transition-opacity"
                onClick={() => window.open(`${API_BASE}${message.fileUrl}`, "_blank")}
              />
              {message.fileName && (
                <div className="text-[11px] text-[var(--text-secondary)] mt-1.5 truncate">{message.fileName}</div>
              )}
            </div>
          ) : isFile && message.fileUrl ? (
            message.fileLanguage ? (
              <FileCard message={message} />
            ) : (
              <a
                href={`${API_BASE}${message.fileUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)]/30 hover:shadow-sm transition-all max-w-[320px]"
              >
              <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium truncate">{message.fileName || "文件"}</div>
                {message.fileSize && (
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {message.fileSize > 1024 * 1024
                      ? `${(message.fileSize / 1024 / 1024).toFixed(1)} MB`
                      : message.fileSize > 1024
                        ? `${Math.round(message.fileSize / 1024)} KB`
                        : `${message.fileSize} B`}
                  </div>
                )}
              </div>
            </a>
            )
          ) : isModify && message.codeSelection ? (
            <div>
              <span className="text-[11px] text-[#FF9500] font-semibold">✏️ 修改请求 · 第{message.codeSelection.start_line}-{message.codeSelection.end_line}行</span>
              <div className="mt-1 text-[14px]">{message.content}</div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap [&>p]:my-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "");
                    const lang = match ? match[1] : "";
                    const content = String(children);
                    const isInline = !match && !content.includes("\n");

                    if (isInline) {
                      return <code className={cn("bg-black/5 dark:bg-white/10 text-[#FF6B35] dark:text-[#FF9F50] text-[13px] px-1 py-0.5 rounded font-mono", className)} {...props}>{children}</code>;
                    }

                    return (
                      <CodeBlock
                        code={content}
                        language={lang}
                        messageId={message.id}
                        onModify={onModify || (() => {})}
                      />
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
