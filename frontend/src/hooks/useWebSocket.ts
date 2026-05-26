"use client";

import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { WS_BASE, API_BASE } from "@/lib/constants";

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
  const lastMessageCreatedAtRef = useRef<string | null>(null);

  // 追踪最新 sessionId，防止旧重连定时器覆盖新连接
  sessionIdRef.current = sessionId;

  // 补齐断线期间丢失的消息
  const fetchMissedMessages = useCallback(async (sId: string) => {
    const since = lastMessageCreatedAtRef.current;
    if (!since) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sId}/messages?since=${encodeURIComponent(since)}&limit=200`);
      if (!res.ok) return;
      const messages = await res.json();
      if (!Array.isArray(messages) || messages.length === 0) return;
      const store = useChatStore.getState();
      const existing = store.messages[sId] || [];
      const existingIds = new Set(existing.map((m) => m.id));
      for (const m of messages) {
        if (existingIds.has(m.id)) continue;
        store.addMessage(sId, {
          id: m.id,
          sessionId: m.session_id || sId,
          agentId: m.agent_id,
          role: m.role === "assistant" ? "agent" : (m.role || "system"),
          content: m.content,
          messageType: m.message_type || "text",
          parentId: m.parent_id,
          codeSelection: m.code_selection,
          fileName: m.file_name,
          fileUrl: m.file_url,
          fileSize: m.file_size,
          createdAt: m.created_at || new Date().toISOString(),
        });
      }
      console.log(`[WS] 补齐 ${messages.length} 条断线消息`);
    } catch (e) {
      console.error("[WS] 断线消息补齐失败:", e);
    }
  }, []);

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
        const wasReconnect = reconnectCountRef.current > 0;
        reconnectCountRef.current = 0;
        // 重连后补齐断线期间丢失的消息
        if (wasReconnect) {
          fetchMissedMessages(currentSessionId);
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const store = useChatStore.getState();
        const p = msg.payload || {};

        if (msg.type === "chat.message" && p.content !== undefined) {
          const createdAt = p.created_at || new Date().toISOString();
          // 追踪最后一条消息时间戳，用于断线补齐
          if (!lastMessageCreatedAtRef.current || createdAt > lastMessageCreatedAtRef.current) {
            lastMessageCreatedAtRef.current = createdAt;
          }
          store.addMessage(sessionId, {
            id: p.id || crypto.randomUUID(),
            sessionId: p.session_id || sessionId,
            agentId: p.agent_id,
            agentRole: p.agent_role,
            role: p.role === "assistant" ? "agent" : (p.role || "system"),
            content: p.content,
            messageType: p.message_type || "text",
            parentId: p.parent_id,
            codeSelection: p.code_selection,
            fileName: p.file_name,
            fileUrl: p.file_url,
            fileSize: p.file_size,
            createdAt,
          });
        } else if (msg.type === "chat.stream.token") {
          store.appendStreamToken(sessionId, p.message_id, p.token);
        } else if (msg.type === "plan.comparison") {
          store.setPlan(sessionId, {
            messageId: p.message_id || "",
            approaches: p.approaches || [],
          });
        } else if (msg.type === "plan.confirmed") {
          store.setConfirmedPlan(sessionId, {
            messageId: p.message_id || "",
            tasks: p.tasks || [],
            hint: p.hint || "",
          });
        } else if (msg.type === "task.update") {
          store.upsertTask(sessionId, {
            taskId: p.task_id,
            title: p.title || "",
            description: p.description || "",
            status: p.status || "pending",
            result: p.result,
            error: p.error,
            retryCount: p.retry_count ?? 0,
            agentId: p.agent_id || "",
            startedAt: p.started_at || "",
            completedAt: p.completed_at || "",
          });
        } else if (msg.type === "artifact.created") {
          store.addArtifact(sessionId, {
            artifactId: p.artifact_id,
            taskId: p.task_id,
            filePath: p.file_path,
            language: p.language,
            contentPreview: p.content_preview,
            originalContent: p.original_content,
            modifiedContent: p.content_preview,
          });
        } else if (msg.type === "session.control") {
          if (p.action === "stopped") {
            store.addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: "system",
              content: "⏹ 任务执行已停止。",
              messageType: "system",
              createdAt: new Date().toISOString(),
            });
          }
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
    lastMessageCreatedAtRef.current = null;  // 切换 session 时重置追踪
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

  const sendMessage = useCallback((content: string, quoteMessageId?: string): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "chat.send",
        payload: { content, quote_message_id: quoteMessageId || "" },
      }));
      return true;
    }
    console.warn("WebSocket 未连接，消息发送失败");
    return false;
  }, []);

  const sendModify = useCallback((messageId: string, startLine: number, endLine: number, instruction: string): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "chat.modify",
        payload: { message_id: messageId, start_line: startLine, end_line: endLine, instruction },
      }));
      return true;
    }
    console.warn("WebSocket 未连接，修改请求发送失败");
    return false;
  }, []);

  const sendPlanAction = useCallback((action: string, taskId?: string, approachName?: string): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const payload: Record<string, string> = { action };
      if (taskId) payload.task_id = taskId;
      if (approachName) payload.approach_name = approachName;
      ws.send(JSON.stringify({ type: "plan.action", payload }));
      return true;
    }
    console.warn("WebSocket 未连接，plan action 发送失败");
    return false;
  }, []);

  const sendSessionControl = useCallback((action: string): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "session.control",
        payload: { action },
      }));
      return true;
    }
    console.warn("WebSocket 未连接，session control 发送失败");
    return false;
  }, []);

  return { sendMessage, sendModify, sendPlanAction, sendSessionControl };
}
