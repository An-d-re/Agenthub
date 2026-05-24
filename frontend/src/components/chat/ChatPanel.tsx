"use client";

import { useEffect, useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatStore } from "@/stores/chatStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  connected: {
    label: "在线",
    className: "bg-orange-500 animate-pulse-glow",
  },
  connecting: {
    label: "连接中",
    className: "bg-yellow-500 animate-pulse",
  },
  disconnected: {
    label: "离线",
    className: "bg-zinc-600",
  },
};

export function ChatPanel() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const { sendMessage } = useWebSocket(activeSessionId);
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__agenthub_ws_send = (content: string) => sendRef.current?.(content);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__agenthub_ws_send;
    };
  }, []);

  const status = STATUS_CONFIG[connectionStatus] || STATUS_CONFIG.disconnected;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* 顶栏 */}
      <div className="border-b border-border/50 px-5 py-3 flex items-center justify-between">
        <h2 className="font-medium text-sm tracking-tight">聊天</h2>
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", status.className)} />
          <span className="text-xs text-muted-foreground">{status.label}</span>
        </div>
      </div>

      <MessageList />
      <MessageInput onSend={sendMessage} disabled={connectionStatus !== "connected"} />
    </div>
  );
}
