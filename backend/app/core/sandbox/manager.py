"""SandboxManager —— 管理每个 session 的独立工作目录。

支持两种模式：
- local：本地 temp 目录 + subprocess（始终可用）
- docker：Docker 容器隔离（需 Docker 运行，可通过配置启用）
"""

import logging
import os
import shutil
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

WORKSPACES_ROOT = Path("workspaces")


class SandboxManager:
    """管理 session 级别的沙箱工作目录。

    每个 session 在 workspaces/{session_id}/ 下有独立的文件系统。
    Agent 生成的代码写入此目录，可以执行、测试、安装依赖。
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.workspace_dir = WORKSPACES_ROOT / session_id
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self._docker_available: bool | None = None

    @property
    def workspace_path(self) -> str:
        return str(self.workspace_dir.resolve())

    @property
    def is_docker_available(self) -> bool:
        """延迟检测 Docker 是否可用。"""
        if self._docker_available is None:
            self._docker_available = self._check_docker()
        return self._docker_available

    def _check_docker(self) -> bool:
        import subprocess
        try:
            result = subprocess.run(
                ["docker", "info"], capture_output=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False

    async def execute_tool(self, tool_name: str, params: dict) -> dict:
        """执行一个工具调用。"""
        from app.core.sandbox.tools import TOOL_REGISTRY

        tool = TOOL_REGISTRY.get(tool_name)
        if not tool or not tool.handler:
            return {"ok": False, "error": f"未知工具: {tool_name}"}

        try:
            # 注入 workspace_dir
            params = {**params, "workspace_dir": self.workspace_path}
            result = await tool.handler(**params)
            return result
        except Exception as e:
            logger.exception("Tool %s 执行失败", tool_name)
            return {"ok": False, "error": str(e)}

    async def execute_code(
        self, code: str, language: str, file_path: str = "",
    ) -> dict:
        """执行代码块：写入文件 → 运行 → 返回结果。"""
        import asyncio

        # 写入文件
        ext_map = {
            "python": "py", "py": "py",
            "javascript": "js", "js": "js",
            "typescript": "ts", "ts": "ts",
            "html": "html",
            "css": "css",
        }
        ext = ext_map.get(language, "txt")
        if not file_path:
            file_path = f"main.{ext}"

        write_result = await self.execute_tool("write_file", {
            "path": file_path, "content": code,
        })
        if not write_result.get("ok"):
            return write_result

        # 运行
        if language in ("python", "py"):
            return await self.execute_tool("run_command", {
                "command": f"python {file_path}",
            })
        elif language in ("javascript", "js"):
            return await self.execute_tool("run_command", {
                "command": f"node {file_path}",
            })
        elif language in ("typescript", "ts"):
            # 先安装 ts-node，再运行
            await self.execute_tool("run_command", {
                "command": "npm install ts-node typescript @types/node 2>&1 || true",
                "timeout": 60,
            })
            return await self.execute_tool("run_command", {
                "command": f"npx ts-node {file_path}",
            })
        elif language == "html":
            return {"ok": True, "file": file_path, "preview": True,
                    "message": "HTML 文件已保存，可通过 Preview 查看"}
        else:
            return {"ok": True, "file": file_path,
                    "message": f"文件已保存: {file_path}（{language} 不支持直接执行）"}

    async def auto_fix_loop(
        self, code: str, language: str, file_path: str = "",
    ) -> dict:
        """执行代码 → 读取错误 → 返回结果。调用方负责 LLM 修复。

        Returns: {"ok": True/False, "output": ..., "error": ...}
        """
        result = await self.execute_code(code, language, file_path)

        if result.get("ok"):
            return {"ok": True, "output": result}

        return {
            "ok": False,
            "error": result.get("stderr") or result.get("error") or "未知错误",
            "output": result,
        }

    def cleanup(self) -> None:
        """清理工作目录。"""
        try:
            if self.workspace_dir.exists():
                shutil.rmtree(self.workspace_dir)
                logger.info("已清理工作目录: %s", self.workspace_dir)
        except Exception:
            logger.exception("清理工作目录失败: %s", self.workspace_dir)

    def __del__(self):
        self.cleanup()


def cleanup_old_workspaces(max_age_hours: int = 24) -> None:
    """启动时清理超过 max_age_hours 的遗留 workspace。"""
    import time
    if not WORKSPACES_ROOT.exists():
        return
    now = time.time()
    for d in WORKSPACES_ROOT.iterdir():
        if d.is_dir():
            try:
                age_hours = (now - d.stat().st_mtime) / 3600
                if age_hours > max_age_hours:
                    shutil.rmtree(d)
                    logger.info("清理旧 workspace: %s (%.1f 小时前)", d, age_hours)
            except Exception:
                pass
