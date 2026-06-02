"""工具注册表 —— Agent 可调用的执行工具。"""

import os as _os
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Callable, Optional

# ── 安全常量 ─────────────────────────────────────────────────
MAX_TIMEOUT = 120  # 命令最大超时秒数
MAX_OUTPUT_CHARS = 5000  # stdout/stderr 最大字符数
DANGEROUS_PATTERNS = [
    "rm -rf /", "mkfs.", "dd if=", ":(){ :|:& };:",  # fork bomb
    "> /dev/sda", "shutdown", "reboot", "chmod 777 /",
]


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


def _safe_path(workspace_dir: str, rel_path: str) -> str:
    """将相对路径解析到 workspace 内，路径越界时抛出 ValueError。"""
    full = _os.path.normpath(_os.path.join(workspace_dir, rel_path))
    norm_workspace = _os.path.normpath(workspace_dir) + _os.sep
    if not full.startswith(norm_workspace) and full != _os.path.normpath(workspace_dir):
        raise ValueError(f"路径越界: {rel_path}")
    return full


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """截断文本，超出部分添加提示。"""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [截断，原 {len(text)} 字符]"


def _check_dangerous(command: str) -> str | None:
    """检查危险命令模式，返回警告信息或 None。"""
    lower = command.lower().replace(" ", "")
    for pat in DANGEROUS_PATTERNS:
        if pat.lower().replace(" ", "") in lower:
            return f"命令包含危险模式，已阻止: {pat}"
    return None


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

def _safe_path(workspace_dir: str, path: str) -> str:
    """解析路径并确保不会逃逸出 workspace_dir。"""
    import os
    workspace = os.path.realpath(workspace_dir)
    full = os.path.realpath(os.path.join(workspace, path))
    if not full.startswith(workspace + os.sep) and full != workspace:
        raise ValueError(f"路径逃逸: {path}")
    return full


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
    try:
        full_path = _safe_path(workspace_dir, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    _os.makedirs(_os.path.dirname(full_path), exist_ok=True)
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
    try:
        full_path = _safe_path(workspace_dir, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    if not _os.path.exists(full_path):
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
    import platform

    danger = _check_dangerous(command)
    if danger:
        return {"ok": False, "error": danger}

    # Windows 兼容：替换 python3 → python
    if platform.system() == "Windows":
        command = command.replace("python3", "python")

    capped_timeout = min(timeout, MAX_TIMEOUT)

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace_dir,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=capped_timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": _truncate(stdout.decode("utf-8", errors="replace")),
            "stderr": _truncate(stderr.decode("utf-8", errors="replace")),
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"命令超时（{capped_timeout}s）"}
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
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=MAX_TIMEOUT)
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": _truncate(stdout.decode("utf-8", errors="replace"), 3000),
            "stderr": _truncate(stderr.decode("utf-8", errors="replace"), 3000),
        }
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"安装超时（{MAX_TIMEOUT}s）"}


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
    try:
        target = _safe_path(workspace_dir, path) if path else workspace_dir
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    if not _os.path.exists(target):
        return {"ok": False, "error": f"目录不存在: {path}"}
    files = []
    for entry in _os.listdir(target):
        full = _os.path.join(target, entry)
        files.append({
            "name": entry,
            "type": "dir" if _os.path.isdir(full) else "file",
            "size": _os.path.getsize(full) if _os.path.isfile(full) else 0,
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
