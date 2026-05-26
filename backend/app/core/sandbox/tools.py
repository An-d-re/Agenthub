"""工具注册表 —— Agent 可调用的执行工具。"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Callable, Optional


class ToolCategory(StrEnum):
    FILE = "file"
    SHELL = "shell"
    PACKAGE = "package"
    VCS = "vcs"


@dataclass
class ToolDefinition:
    name: str
    description: str
    category: ToolCategory
    parameters: dict  # JSON Schema for parameters
    handler: Optional[Callable] = None  # 实际执行函数


# ── 工具注册表 ──────────────────────────────────────────────

TOOL_REGISTRY: dict[str, ToolDefinition] = {}


def register_tool(
    name: str, description: str, category: ToolCategory, parameters: dict,
):
    """装饰器：注册工具到全局注册表。"""
    def decorator(func: Callable):
        TOOL_REGISTRY[name] = ToolDefinition(
            name=name, description=description, category=category,
            parameters=parameters, handler=func,
        )
        return func
    return decorator


# ── 内置工具 ─────────────────────────────────────────────────

@register_tool(
    "write_file",
    "将内容写入文件",
    ToolCategory.FILE,
    {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件路径（相对于工作目录）"},
            "content": {"type": "string", "description": "文件内容"},
        },
        "required": ["path", "content"],
    },
)
async def write_file(path: str, content: str, workspace_dir: str) -> dict:
    import os
    full_path = os.path.join(workspace_dir, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"ok": True, "path": path, "size": len(content)}


@register_tool(
    "read_file",
    "读取文件内容",
    ToolCategory.FILE,
    {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件路径（相对于工作目录）"},
        },
        "required": ["path"],
    },
)
async def read_file(path: str, workspace_dir: str) -> dict:
    import os
    full_path = os.path.join(workspace_dir, path)
    if not os.path.exists(full_path):
        return {"ok": False, "error": f"文件不存在: {path}"}
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"ok": True, "path": path, "content": content}


@register_tool(
    "run_command",
    "在工作目录中执行 shell 命令",
    ToolCategory.SHELL,
    {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "要执行的命令"},
            "timeout": {"type": "integer", "description": "超时秒数，默认 30", "default": 30},
        },
        "required": ["command"],
    },
)
async def run_command(command: str, workspace_dir: str, timeout: int = 30) -> dict:
    import asyncio
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_dir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace")[:5000],
            "stderr": stderr.decode("utf-8", errors="replace")[:5000],
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"命令超时（{timeout}s）"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@register_tool(
    "install_deps",
    "安装项目依赖（自动检测语言）",
    ToolCategory.PACKAGE,
    {
        "type": "object",
        "properties": {
            "language": {"type": "string", "description": "语言：python / node / rust"},
        },
        "required": ["language"],
    },
)
async def install_deps(language: str, workspace_dir: str) -> dict:
    import asyncio
    commands = {
        "python": "pip install -r requirements.txt 2>&1 || pip install --no-deps . 2>&1",
        "node": "npm install 2>&1",
        "rust": "cargo build 2>&1",
    }
    cmd = commands.get(language, "")
    if not cmd:
        return {"ok": False, "error": f"不支持的语言: {language}"}
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_dir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace")[:3000],
            "stderr": stderr.decode("utf-8", errors="replace")[:3000],
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": "安装超时（120s）"}


@register_tool(
    "list_files",
    "列出工作目录中的文件",
    ToolCategory.FILE,
    {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "子目录路径，留空表示根目录", "default": ""},
        },
        "required": [],
    },
)
async def list_files(path: str = "", workspace_dir: str = "") -> dict:
    import os
    target = os.path.join(workspace_dir, path) if path else workspace_dir
    if not os.path.exists(target):
        return {"ok": False, "error": f"目录不存在: {path}"}
    files = []
    for entry in os.listdir(target):
        full = os.path.join(target, entry)
        files.append({
            "name": entry,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": os.path.getsize(full) if os.path.isfile(full) else 0,
        })
    return {"ok": True, "files": files[:100]}


def get_tools_schema() -> list[dict]:
    """生成工具列表的 JSON Schema，供 LLM function calling 使用。"""
    return [
        {
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        }
        for t in TOOL_REGISTRY.values()
    ]
