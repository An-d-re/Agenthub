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
  { ssr: false, loading: () => <div className="h-64 bg-[var(--bg-secondary)] animate-skeleton rounded-xl" /> }
);

interface DiffCardProps {
  artifact: ArtifactItem;
  open?: boolean;
  onClose?: () => void;
}

export function DiffCard({ artifact, open: externalOpen, onClose }: DiffCardProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (externalOpen !== undefined) {
      if (!v) onClose?.();
    } else {
      setInternalOpen(v);
    }
  };
  const [code, setCode] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyStatus, setApplyStatus] = useState<"success" | "merged" | "conflict" | "">("");

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
    setApplyStatus("");
    try {
      const res = await fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}/apply`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setApplied(true);
        setApplyStatus(data.auto_merged ? "merged" : "success");
        if (data.auto_merged) {
          setApplyError("");
        }
      } else if (data.conflict && data.auto_merged) {
        setApplyStatus("conflict");
        setApplyError(`自动合并后有 ${data.conflict_count || 0} 处冲突，已写入带标记的文件。可点击"强制覆盖"使用 Agent 版本。`);
        // 展示合并后的内容
        if (data.merged_content) {
          setCode(data.merged_content);
        }
      } else if (data.conflict) {
        setApplyStatus("conflict");
        setApplyError(data.hint || "文件冲突，请先处理已有文件");
      } else {
        setApplyError("应用失败");
      }
    } catch {
      setApplyError("网络错误");
    } finally {
      setApplying(false);
    }
  };

  const handleForceApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artifact.artifactId) return;
    setApplying(true);
    setApplyError("");
    setApplyStatus("");
    try {
      const res = await fetch(`${API_BASE}/api/artifacts/${artifact.artifactId}/apply?force=true`, { method: "POST" });
      if (res.ok) {
        setApplied(true);
        setApplyStatus("success");
      } else {
        setApplyError("强制覆盖失败");
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
      {externalOpen === undefined && (
        <div className="flex flex-col items-center w-full my-2 animate-fade-in">
          <div
            onClick={handleOpen}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card dark:bg-[var(--bg-secondary)] hover:border-accent/40 cursor-pointer transition-colors max-w-md"
          >
            <span className="text-sm">📄</span>
            <span className="text-xs font-mono truncate flex-1">{fileName}</span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {langLabel}
            </Badge>
            <span className="text-[10px] text-muted-foreground">查看 Diff</span>
            {applied ? (
              <span className="text-[10px] text-[var(--success)] font-medium">
                {applyStatus === "merged" ? "✓ 已合并" : "✓ 已应用"}
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
                >
                  {applying ? "应用中..." : "应用"}
                </button>
                {applyStatus === "conflict" && (
                  <button
                    onClick={handleForceApply}
                    disabled={applying}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--danger)] text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    强制覆盖
                  </button>
                )}
              </div>
            )}
          </div>
          {applyError && (
            <div className={applyStatus === "conflict" ? "text-[11px] text-amber-600 dark:text-amber-400 mt-1" : "text-[11px] text-[var(--danger)] mt-1"}>{applyError}</div>
          )}
        </div>
      )}

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
