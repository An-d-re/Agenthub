"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

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

  useEffect(() => {
    if (!sessionId) return;

    const clientId = getClientId();
    const url = `${WS_BASE}/ws/${sessionId}?client_id=${clientId}`;

    useChatStore.getState().setConnectionStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      useChatStore.getState().setConnectionStatus("connected");
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
            role: p.role || "system",
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
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      useChatStore.getState().setConnectionStatus("disconnected");
    };

    return () => {
      ws.close();
      wsRef.current = null;
      useChatStore.getState().setConnectionStatus("disconnected");
    };
  }, [sessionId]);

  const sendMessage = (content: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat.send", payload: { content } }));
    }
  };

  return { sendMessage };
}
