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

const MonacoDiff = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  { ssr: false, loading: () => <div className="h-64 bg-muted animate-pulse rounded" /> }
);

export interface ArtifactData {
  artifactId: string;
  taskId?: string;
  filePath: string;
  language: string;
  originalContent?: string;
  modifiedContent?: string;
  contentPreview?: string;
}

interface DiffCardProps {
  artifact: ArtifactData;
}

export function DiffCard({ artifact }: DiffCardProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const handleOpen = async () => {
    if (!code && artifact.artifactId) {
      try {
        const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${base}/api/artifacts/${artifact.artifactId}`);
        if (res.ok) {
          const data = await res.json();
          setCode(data.modified_content || "");
        }
      } catch {
        // use preview
      }
    }
    setOpen(true);
  };

  const langLabel = artifact.language || "text";
  const fileName = artifact.filePath?.split("/").pop() || artifact.filePath;

  return (
    <>
      <div className="flex justify-center w-full my-2 animate-fade-in">
        <div
          onClick={handleOpen}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:border-accent/40 cursor-pointer transition-colors max-w-md"
        >
          <span className="text-sm">📄</span>
          <span className="text-xs font-mono truncate flex-1">{fileName}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {langLabel}
          </Badge>
          <span className="text-[10px] text-muted-foreground">查看 Diff</span>
        </div>
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
