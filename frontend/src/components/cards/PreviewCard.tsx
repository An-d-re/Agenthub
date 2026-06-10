"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatStore } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ArtifactItem } from "@/stores/chatStore";

const DEVICE_PRESETS = [
  { key: "phone",   w: 375, h: 667,  label: "📱 手机" },
  { key: "tablet",  w: 768, h: 1024, label: "📋 平板" },
  { key: "desktop", w: 0,   h: 0,    label: "🖥️ 桌面" },
] as const;

type DeviceKey = (typeof DEVICE_PRESETS)[number]["key"];

interface Props {
  artifact: ArtifactItem;
  open?: boolean;
  onClose?: () => void;
}

export function PreviewCard({ artifact, open: externalOpen, onClose }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (externalOpen !== undefined) {
      if (!v) onClose?.();
    } else {
      setInternalOpen(v);
    }
  };
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  const activeSessionId = useChatStore(s => s.activeSessionId);

  // 外部 open 控制时，弹窗打开后自动拉取内容
  useEffect(() => {
    if (open && !html && artifact.artifactId) {
      fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) setHtml(data.modified_content || data.content_preview || "");
        })
        .catch(() => console.warn("获取预览内容失败"));
    }
  }, [open, html, artifact.artifactId]);

  const handleOpen = async () => {
    if (!html && artifact.artifactId) {
      try {
        const res = await fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}`);
        if (res.ok) {
          const data = await res.json();
          setHtml(data.modified_content || data.content_preview || "");
        }
      } catch {
        console.warn("获取预览内容失败");
      }
    }
    setOpen(true);
  };

  const handleDeploy = async () => {
    if (!activeSessionId || !artifact.artifactId) return;
    setDeploying(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/deployments?artifact_id=${artifact.artifactId}&session_id=${activeSessionId}`,
        { method: "POST" }
      );
      if (res.ok) {
        const data = await res.json();
        // 轮询直到运行或失败
        const poll = async (retries = 10) => {
          const sr = await fetch(`${API_BASE}/api/deployments?session_id=${activeSessionId}`);
          if (sr.ok) {
            const list = await sr.json();
            const d = list.find((item: {id:string;status:string;url:string}) => item.id === data.id);
            if (d) {
              if (d.status === "running") {
                setDeployUrl(`${API_BASE}${d.url}`);
                setDeploying(false);
                return;
              }
              if (d.status === "failed") {
                setDeploying(false);
                return;
              }
            }
          }
          if (retries > 0) setTimeout(() => poll(retries - 1), 2000);
          else setDeploying(false);
        };
        setTimeout(() => poll(), 2000);
      }
    } catch (e) {
      console.warn("部署失败", e);
      setDeploying(false);
    }
  };

  const getPreviewContent = () => {
    const code = html || artifact.contentPreview || "";
    const lang = artifact.language || "text";

    if (lang === "html" || !code) return code;
    if (lang === "svg") return code;

    // 包装非 HTML 内容为可预览页面
    if (lang === "css") {
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${code}</style></head><body><div class="preview">CSS 样式预览 — 应用到本页面的样式</div></body></html>`;
    }
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Preview</title></head><body><pre style="font-family:monospace;padding:16px;white-space:pre-wrap;">${escapeHtml(code)}</pre></body></html>`;
  };

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const preset = DEVICE_PRESETS.find(p => p.key === device) || DEVICE_PRESETS[2];
  const isDesktop = preset.key === "desktop";
  const fileName = artifact.filePath?.split("/").pop() || artifact.filePath;

  return (
    <>
      {externalOpen === undefined && (
        <div className="flex justify-center w-full my-2 animate-fade-in">
          <div
            onClick={handleOpen}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 hover:border-[var(--success)]/60 cursor-pointer transition-colors"
          >
            <span className="text-sm">🌐</span>
            <span className="text-xs font-mono truncate max-w-[160px]">{fileName}</span>
            <span className="text-[10px] text-[var(--success)] font-medium">预览</span>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono flex items-center gap-3">
              <span>{artifact.filePath}</span>
              <button
                onClick={handleDeploy}
                disabled={deploying || !!deployUrl}
                className={cn(
                  "px-3 py-1 rounded-[8px] text-[11px] font-medium transition-all",
                  deployUrl
                    ? "bg-[var(--success)]/10 text-[var(--success)]"
                    : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                )}
              >
                {deploying ? "部署中..." : deployUrl ? "✓ 已部署" : "🚀 一键部署"}
              </button>
            </DialogTitle>
          </DialogHeader>

          {deployUrl && (
            <div className="flex items-center gap-2 px-4 py-2 bg-[var(--success)]/5 rounded-xl border border-[var(--success)]/20 text-[13px]">
              <span className="text-[var(--success)]">✅</span>
              <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline font-mono text-[12px] truncate">
                {deployUrl}
              </a>
              <button
                onClick={() => navigator.clipboard?.writeText(deployUrl)}
                className="ml-auto text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
              >
                复制
              </button>
            </div>
          )}

          {/* Device switcher */}
          <div className="flex items-center justify-center gap-1 bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] rounded-xl p-1 w-fit mx-auto">
            {DEVICE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setDevice(p.key)}
                className={cn(
                  "px-3 py-1.5 rounded-[12px] text-[12px] font-medium transition-all",
                  device === p.key ? "bg-white dark:bg-[var(--bg-tertiary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Preview iframe */}
          <div className="flex-1 min-h-0 flex justify-center">
            <div
              className={cn(
                "border border-[var(--border)] rounded-xl overflow-hidden bg-white transition-all duration-300",
                isDesktop ? "w-full h-full" : ""
              )}
              style={isDesktop ? undefined : { width: preset.w, height: preset.h, maxHeight: "100%" }}
            >
              <iframe
                srcDoc={getPreviewContent()}
                sandbox="allow-scripts allow-same-origin"
                className="w-full h-full border-0"
                title="preview"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
