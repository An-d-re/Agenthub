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
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06] border-l-2 border-[#007AFF]/40 mb-2 text-[12px]">
      <span className="text-[#007AFF] font-medium shrink-0">
        {msg.role === "user" ? "你" : "Agent"}
      </span>
      <span className="text-[#86868B] truncate">{preview}{(msg.content || "").length > 80 ? "…" : ""}</span>
    </div>
  );
}

export function MessageBubble({ message, index = 0, onModify, onRegenerate }: Props) {
  const agents = useAgentStore(s => s.agents);
  const setReplyTarget = useChatStore(s => s.setReplyTarget);
  const allMessages = useChatStore(s => s.messages);
  const [hovered, setHovered] = useState(false);

  const getAgentName = (agentId?: string) => {
    if (!agentId) return "Agent";
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || "Agent";
  };

  // 查找被引用的消息
  const quotedMessage = message.parentId && message.messageType !== "modify"
    ? (allMessages[message.sessionId] || []).find(m => m.id === message.parentId)
    : null;

  if (message.role === "system") {
    return (
      <motion.div {...bubbleSpring} transition={{ ...bubbleSpring.transition, delay: index * 0.03 }}
        className="flex justify-center w-full my-2">
        <div className="max-w-[70%] text-center text-[12px] text-[#86868B] dark:text-[#98989D] bg-[#F0F0F5] dark:bg-[#2C2C2E] px-5 py-2 rounded-2xl">
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
        isUser ? "bg-[#007AFF]/10" : "bg-[#F5F5F7] dark:bg-[#2C2C2E]"
      )}>
        {isUser ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#86868B" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16c0-2 4-4 8-4s4 2 4 4"/></svg>
        )}
      </div>

      <div className={cn("max-w-[75%] flex flex-col relative", isUser ? "items-end" : "items-start")}>
        {!isUser && (
          <span className="text-[12px] font-semibold text-[#86868B] dark:text-[#98989D] mb-1 ml-1">{getAgentName(message.agentId)}</span>
        )}
        {/* 引用回复按钮（悬停显示） */}
        {!isUser && hovered && (
          <div className="absolute -right-8 top-1 flex flex-col gap-1 z-10">
            <button
              onClick={handleReply}
              className="w-6 h-6 rounded-full bg-white border border-[#E5E5E7] shadow-sm flex items-center justify-center text-[#86868B] hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all"
              title="引用回复"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 17 4 12 9 7" /><path d="M4 12h10a6 6 0 0 1 6 6v1" />
              </svg>
            </button>
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="w-6 h-6 rounded-full bg-white border border-[#E5E5E7] shadow-sm flex items-center justify-center text-[#86868B] hover:text-[#34C759] hover:border-[#34C759]/30 transition-all"
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
            className="absolute -left-8 top-1 w-6 h-6 rounded-full bg-white border border-[#E5E5E7] shadow-sm flex items-center justify-center text-[#86868B] hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all z-10"
            title="引用回复"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" /><path d="M4 12h10a6 6 0 0 1 6 6v1" />
            </svg>
          </button>
        )}
        <div className={cn(
          "rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
          isUser
            ? "bg-[#007AFF] text-white rounded-br-[4px]"
            : isModify
              ? "bg-[#FFF3E0] dark:bg-[#3D2910] text-[#1D1D1F] dark:text-[#F5F5F7] rounded-bl-[4px] border border-[#FFCC80] dark:border-[#664400]"
              : isImage || isFile
                ? "bg-[#F5F5F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] rounded-bl-[4px]"
                : "bg-[#F5F5F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] rounded-bl-[4px]"
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
                <div className="text-[11px] text-[#86868B] mt-1.5 truncate">{message.fileName}</div>
              )}
            </div>
          ) : isFile && message.fileUrl ? (
            <a
              href={`${API_BASE}${message.fileUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#E5E5E7] hover:border-[#007AFF]/30 hover:shadow-sm transition-all max-w-[320px]"
            >
              <div className="w-10 h-10 rounded-xl bg-[#007AFF]/10 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium truncate">{message.fileName || "文件"}</div>
                {message.fileSize && (
                  <div className="text-[11px] text-[#86868B]">
                    {message.fileSize > 1024 * 1024
                      ? `${(message.fileSize / 1024 / 1024).toFixed(1)} MB`
                      : message.fileSize > 1024
                        ? `${Math.round(message.fileSize / 1024)} KB`
                        : `${message.fileSize} B`}
                  </div>
                )}
              </div>
            </a>
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
