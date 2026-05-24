"use client";

import { useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatStore } from "@/stores/chatStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

const STATUS_LABEL: Record<string, string> = {
  connected: "已连接",
  connecting: "连接中",
  disconnected: "已断开",
};

export function ChatPanel() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const { sendMessage } = useWebSocket(activeSessionId);
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;

  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__agenthub_ws_send = (content: string) => sendRef.current?.(content);
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <h2 className="font-semibold text-sm">聊天</h2>
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connectionStatus === "connected"
              ? "bg-green-500 animate-pulse-glow"
              : connectionStatus === "connecting"
              ? "bg-yellow-500"
              : "bg-red-500"
          }`}
        />
        <span className="text-xs text-muted-foreground">
          {STATUS_LABEL[connectionStatus] || connectionStatus}
        </span>
      </div>

      <MessageList />
      <MessageInput onSend={sendMessage} disabled={connectionStatus !== "connected"} />
    </div>
  );
}
