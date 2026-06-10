"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/constants";
import { PreviewCard } from "./PreviewCard";
import { DiffCard } from "./DiffCard";
import type { ArtifactItem, ChatMessage } from "@/stores/chatStore";

const PREVIEW_LANGUAGES = new Set(["html", "svg"]);

interface Props {
  message: ChatMessage;
}

function extractArtifactId(fileUrl?: string): string | null {
  if (!fileUrl) return null;
  const match = fileUrl.match(/\/api\/artifacts\/([^/]+)\/download/);
  return match ? match[1] : null;
}

function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function FileTypeIcon({ language }: { language?: string }) {
  const cls = "w-5 h-5";
  switch (language) {
    case "html":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="#E44D26" strokeWidth="2" strokeLinecap="round">
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "python":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="#3776AB" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2C7.58 2 4 3.79 4 6v3h8V8H6" /><path d="M12 22c4.42 0 8-1.79 8-4v-3h-8v1h6" />
        </svg>
      );
    case "css":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="#1572B6" strokeWidth="2" strokeLinecap="round">
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "javascript":
    case "typescript":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="#F7DF1E" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="2" width="20" height="20" rx="3" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="12" y2="16" />
        </svg>
      );
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
  }
}

export function FileCard({ message }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const artifactId = extractArtifactId(message.fileUrl);
  const artifactItem: ArtifactItem = {
    artifactId: artifactId || "",
    filePath: message.fileName || "",
    language: message.fileLanguage || "text",
    contentPreview: "",
  };

  const canPreview = message.fileLanguage && PREVIEW_LANGUAGES.has(message.fileLanguage);
  const downloadUrl = message.fileUrl ? `${API_BASE}${message.fileUrl}` : "#";
  const fileSizeDisplay = formatFileSize(message.fileSize);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-white dark:bg-[var(--bg-primary)] border border-[var(--border)] max-w-[340px] shadow-sm">
      {/* Header: icon + name + badge + size */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
          <FileTypeIcon language={message.fileLanguage} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium truncate">{message.fileName || "文件"}</div>
          <div className="flex items-center gap-2 mt-0.5">
            {message.fileLanguage && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-mono uppercase">
                {message.fileLanguage}
              </span>
            )}
            {fileSizeDisplay && (
              <span className="text-[11px] text-[var(--text-tertiary)]">{fileSizeDisplay}</span>
            )}
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
        {canPreview && (
          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-1 rounded-[8px] text-[12px] font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
          >
            预览
          </button>
        )}
        <button
          onClick={() => setShowCode(true)}
          className="px-3 py-1 rounded-[8px] text-[12px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors"
        >
          查看代码
        </button>
        <a
          href={downloadUrl}
          download
          className="ml-auto px-3 py-1 rounded-[8px] text-[12px] font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors no-underline"
        >
          下载
        </a>
      </div>

      {/* Preview modal */}
      {showPreview && artifactId && (
        <PreviewCard
          artifact={artifactItem}
          open={showPreview}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Code view modal */}
      {showCode && artifactId && (
        <DiffCard
          artifact={artifactItem}
          open={showCode}
          onClose={() => setShowCode(false)}
        />
      )}
    </div>
  );
}
