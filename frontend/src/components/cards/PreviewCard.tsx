"use client";

import { useState } from "react";
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
}

export function PreviewCard({ artifact }: Props) {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  const activeSessionId = useChatStore(s => s.activeSessionId);

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
        if (data.status === "running") {
          setDeployUrl(`${API_BASE}${data.url}`);
        }
      }
    } catch (e) {
      console.warn("部署失败", e);
    } finally {
      setDeploying(false);
    }
  };

  const preset = DEVICE_PRESETS.find(p => p.key === device) || DEVICE_PRESETS[2];
  const isDesktop = preset.key === "desktop";
  const fileName = artifact.filePath?.split("/").pop() || artifact.filePath;

  return (
    <>
      <div className="flex justify-center w-full my-2 animate-fade-in">
        <div
          onClick={handleOpen}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#34C759]/30 bg-[#34C759]/5 hover:border-[#34C759]/60 cursor-pointer transition-colors"
        >
          <span className="text-sm">🌐</span>
          <span className="text-xs font-mono truncate max-w-[160px]">{fileName}</span>
          <span className="text-[10px] text-[#34C759] font-medium">预览</span>
        </div>
      </div>

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
                    ? "bg-[#34C759]/10 text-[#34C759]"
                    : "bg-[#007AFF] text-white hover:bg-[#0066D6] disabled:opacity-50"
                )}
              >
                {deploying ? "部署中..." : deployUrl ? "✓ 已部署" : "🚀 一键部署"}
              </button>
            </DialogTitle>
          </DialogHeader>

          {deployUrl && (
            <div className="flex items-center gap-2 px-4 py-2 bg-[#34C759]/5 rounded-xl border border-[#34C759]/20 text-[13px]">
              <span className="text-[#34C759]">✅</span>
              <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="text-[#007AFF] hover:underline font-mono text-[12px] truncate">
                {deployUrl}
              </a>
              <button
                onClick={() => navigator.clipboard?.writeText(deployUrl)}
                className="ml-auto text-[11px] text-[#86868B] hover:text-[#1D1D1F] shrink-0"
              >
                复制
              </button>
            </div>
          )}

          {/* Device switcher */}
          <div className="flex items-center justify-center gap-1 bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-xl p-1 w-fit mx-auto">
            {DEVICE_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setDevice(p.key)}
                className={cn(
                  "px-3 py-1.5 rounded-[10px] text-[12px] font-medium transition-all",
                  device === p.key ? "bg-white dark:bg-[#3A3A3C] shadow-sm text-[#1D1D1F] dark:text-[#F5F5F7]" : "text-[#86868B] dark:text-[#98989D] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7]"
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
                "border border-[#E5E5E7] rounded-xl overflow-hidden bg-white transition-all duration-300",
                isDesktop ? "w-full h-full" : ""
              )}
              style={isDesktop ? undefined : { width: preset.w, height: preset.h, maxHeight: "100%" }}
            >
              <iframe
                srcDoc={html || artifact.contentPreview || ""}
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
