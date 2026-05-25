"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ArtifactItem } from "@/stores/chatStore";
import { API_BASE } from "@/lib/constants";

const MonacoDiff = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  { ssr: false, loading: () => <div className="h-64 bg-[#F5F5F7] animate-skeleton rounded-xl" /> }
);

interface DiffCardProps {
  artifact: ArtifactItem;
}

export function DiffCard({ artifact }: DiffCardProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState("");

  const handleOpen = async () => {
    if (!code && artifact.artifactId) {
      try {
        const res = await fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}`);
        if (res.ok) {
          const data = await res.json();
          setCode(data.modified_content || "");
        }
      } catch {
        console.warn("获取 artifact 内容失败，将使用预览");
      }
    }
    setOpen(true);
  };

  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artifact.artifactId) return;
    setApplying(true);
    setApplyError("");
    try {
      const res = await fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}/apply`, { method: "POST" });
      if (res.ok) {
        setApplied(true);
      } else if (res.status === 409) {
        const data = await res.json();
        setApplyError(data.detail || "文件冲突，请先处理已有文件");
      } else {
        setApplyError("应用失败");
      }
    } catch {
      setApplyError("网络错误");
    } finally {
      setApplying(false);
    }
  };

  const langLabel = artifact.language || "text";
  const fileName = artifact.filePath?.split("/").pop() || artifact.filePath;

  return (
    <>
      <div className="flex flex-col items-center w-full my-2 animate-fade-in">
        <div
          onClick={handleOpen}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border dark:border-[#38383A] bg-card dark:bg-[#2C2C2E] hover:border-accent/40 cursor-pointer transition-colors max-w-md"
        >
          <span className="text-sm">📄</span>
          <span className="text-xs font-mono truncate flex-1">{fileName}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {langLabel}
          </Badge>
          <span className="text-[10px] text-muted-foreground">查看 Diff</span>
          {applied ? (
            <span className="text-[10px] text-[#34C759] font-medium">✓ 已应用</span>
          ) : (
            <button
              onClick={handleApply}
              disabled={applying}
              className="text-[10px] px-2 py-0.5 rounded-md bg-[#007AFF] text-white hover:bg-[#0066D6] disabled:opacity-50 transition-colors"
            >
              {applying ? "应用中..." : "应用"}
            </button>
          )}
        </div>
        {applyError && (
          <div className="text-[11px] text-[#FF3B30] mt-1">{applyError}</div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono flex items-center gap-2">
              <span>{artifact.filePath}</span>
              <Badge variant="outline" className="text-[10px]">{langLabel}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <MonacoDiff
              original={artifact.originalContent || ""}
              modified={code || artifact.modifiedContent || artifact.contentPreview || ""}
              language={artifact.language || "text"}
              theme="vs-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
              }}
              height="100%"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
