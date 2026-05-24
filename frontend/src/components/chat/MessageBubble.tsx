"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/stores/chatStore";

interface Props { message: ChatMessage; index?: number; }

const bubbleSpring = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: "spring" as const, stiffness: 400, damping: 30 },
};

export function MessageBubble({ message, index = 0 }: Props) {
  if (message.role === "system") {
    return (
      <motion.div {...bubbleSpring} transition={{ ...bubbleSpring.transition, delay: index * 0.03 }}
        className="flex justify-center w-full my-2">
        <div className="max-w-[70%] text-center text-[12px] text-[#86868B] bg-[#F0F0F5] px-5 py-2 rounded-2xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </motion.div>
    );
  }

  const isUser = message.role === "user";

  return (
    <motion.div {...bubbleSpring} transition={{ ...bubbleSpring.transition, delay: index * 0.03 }}
      className={cn("flex w-full mb-1.5 px-6 gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
        isUser ? "bg-[#007AFF]/10" : "bg-[#F5F5F7]"
      )}>
        {isUser ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#86868B" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16c0-2 4-4 8-4s4 2 4 4"/></svg>
        )}
      </div>

      <div className={cn("max-w-[65%] flex flex-col", isUser ? "items-end" : "items-start")}>
        {!isUser && (
          <span className="text-[12px] font-semibold text-[#86868B] mb-1 ml-1">Agent</span>
        )}
        <div className={cn(
          "rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm",
          isUser
            ? "bg-[#007AFF] text-white rounded-br-[4px]"
            : "bg-[#F5F5F7] text-[#1D1D1F] rounded-bl-[4px]"
        )}>
          <div className="whitespace-pre-wrap [&>p]:my-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
