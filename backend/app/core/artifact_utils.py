"""Shared utility for extracting code blocks from markdown agent responses."""

import re as _re
import uuid

from app.models.artifact import Artifact


def extract_code_blocks(content: str) -> list[dict]:
    """Extract code blocks from markdown. Returns list of {file_path, language, content}."""
    blocks: list[dict] = []
    matches = _re.findall(r'```(\w+)?\s*\n(.*?)```', content, _re.DOTALL)
    for lang, code in matches:
        clean_code = code.strip()
        if not clean_code:
            continue
        file_path = _guess_file_path(clean_code, lang or "text")
        blocks.append({
            "file_path": file_path,
            "language": lang or "text",
            "content": clean_code,
        })
    return blocks


def create_artifacts_from_blocks(
    blocks: list[dict],
    session_id: str,
    task_id: str | None = None,
    artifact_type: str = "code",
) -> list[Artifact]:
    """Create Artifact ORM instances from extracted code block dicts."""
    artifacts: list[Artifact] = []
    for block in blocks:
        art = Artifact(
            id=str(uuid.uuid4()),
            task_id=task_id,
            session_id=session_id,
            file_path=block["file_path"],
            original_content=None,
            modified_content=block["content"],
            language=block.get("language", "text"),
            artifact_type=artifact_type,
        )
        artifacts.append(art)
    return artifacts


def _guess_file_path(code: str, lang: str) -> str:
    """Guess file path from code comment or language extension."""
    ext_map = {
        "python": "py", "py": "py",
        "javascript": "js", "js": "js",
        "typescript": "ts", "ts": "ts",
        "tsx": "tsx", "jsx": "jsx",
        "html": "html", "css": "css",
        "json": "json", "sql": "sql",
        "bash": "sh", "sh": "sh",
        "yaml": "yml", "yml": "yml",
    }
    ext = ext_map.get(lang, lang)
    return f"output.{ext}"
