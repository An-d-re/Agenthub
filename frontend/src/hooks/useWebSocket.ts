"use client";

import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { WS_BASE } from "@/lib/constants";

const RECONNECT_DELAYS = [1, 2, 4, 8];  // 重连间隔（秒）
const MAX_RECONNECT_ATTEMPTS = 4;

function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("agenthub_client_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("agenthub_client_id", id);
  }
  return id;
}

export function useWebSocket(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);

  // 追踪最新 sessionId，防止旧重连定时器覆盖新连接
  sessionIdRef.current = sessionId;

  const connect = useCallback(() => {
    if (!sessionId) return;

    const currentSessionId = sessionId;
    const clientId = getClientId();
    const url = `${WS_BASE}/ws/${sessionId}?client_id=${clientId}`;

    useChatStore.getState().setConnectionStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // 只有当前 session 未变时才更新状态
      if (sessionIdRef.current === currentSessionId) {
        useChatStore.getState().setConnectionStatus("connected");
        reconnectCountRef.current = 0;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const store = useChatStore.getState();
        const p = msg.payload || {};

        if (msg.type === "chat.message" && p.content !== undefined) {
          store.addMessage(sessionId, {
            id: p.id || crypto.randomUUID(),
            sessionId: p.session_id || sessionId,
            agentId: p.agent_id,
            role: p.role === "assistant" ? "agent" : (p.role || "system"),
            content: p.content,
            messageType: p.message_type || "text",
            createdAt: p.created_at || new Date().toISOString(),
          });
        } else if (msg.type === "plan.comparison") {
          store.setPlan(sessionId, {
            messageId: p.message_id || "",
            approaches: p.approaches || [],
          });
        } else if (msg.type === "task.update") {
          store.upsertTask(sessionId, {
            taskId: p.task_id,
            title: p.title || "",
            status: p.status || "pending",
            result: p.result,
            error: p.error,
          });
        } else if (msg.type === "artifact.created") {
          store.addArtifact(sessionId, {
            artifactId: p.artifact_id,
            taskId: p.task_id,
            filePath: p.file_path,
            language: p.language,
            contentPreview: p.content_preview,
          });
        }
      } catch (e) {
        console.error("WebSocket 消息解析失败:", e);
      }
    };

    ws.onclose = () => {
      // 只有当前 session 未变时才重连，防止旧定时器覆盖新连接
      if (sessionIdRef.current !== currentSessionId) {
        return;
      }
      useChatStore.getState().setConnectionStatus("disconnected");
      if (reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAYS[reconnectCountRef.current] * 1000;
        reconnectCountRef.current++;
        console.warn(`WebSocket 断开，${delay}ms 后重连 (${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [sessionId]);

  useEffect(() => {
    reconnectCountRef.current = 0;
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      // 先清除 onclose 防止 cleanup 触发的 close 又安排重连
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      useChatStore.getState().setConnectionStatus("disconnected");
    };
  }, [connect]);

  const sendMessage = useCallback((content: string): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat.send", payload: { content } }));
      return true;
    }
    console.warn("WebSocket 未连接，消息发送失败");
    return false;
  }, []);

  return { sendMessage };
}
