"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface Props {
  url?: string;
  status?: string;
  error?: string;
  artifactId?: string;
  onOpen?: () => void;
}

export function DeployCard({ url, status = "deploying", error, onOpen }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className="my-2 rounded-xl border overflow-hidden"
      style={{
        borderColor: status === "deployed" ? "var(--success)/0.25" :
                     status === "failed" ? "var(--danger)/0.25" :
                     "var(--accent)/0.15",
        background: status === "deployed" ? "var(--success)/0.04" :
                    status === "failed" ? "var(--danger)/0.04" :
                    "var(--accent)/0.04",
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="shrink-0">
          {status === "deploying" && (
            <div className="w-6 h-6 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)] animate-spin" />
          )}
          {status === "deployed" && (
            <div className="w-6 h-6 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          )}
          {status === "failed" && (
            <div className="w-6 h-6 rounded-full bg-[var(--danger)]/15 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold" style={{
            color: status === "deployed" ? "var(--success)" :
                   status === "failed" ? "var(--danger)" :
                   "var(--accent)",
          }}>
            {status === "deploying" ? "部署中…" :
             status === "deployed" ? "已部署" :
             status === "failed" ? "部署失败" : status}
          </div>
          {url && (
            <div className="flex items-center gap-2 mt-1">
              <a
                href={url} target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)] truncate max-w-[200px] underline underline-offset-2"
              >
                {url}
              </a>
              <button
                onClick={handleCopyUrl}
                className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors shrink-0"
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          )}
          {error && (
            <div className="text-[11px] text-[var(--danger)]/80 mt-0.5">{error}</div>
          )}
        </div>

        {/* Actions */}
        {url && onOpen && (
          <button
            onClick={onOpen}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-[11px] font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            打开预览
          </button>
        )}
      </div>
    </motion.div>
  );
}
