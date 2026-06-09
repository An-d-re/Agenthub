"""Three-way text merge using difflib — zero external dependencies."""

from dataclasses import dataclass, field
from difflib import SequenceMatcher


@dataclass
class MergeResult:
    merged_content: str
    has_conflicts: bool = False
    conflict_count: int = 0


def three_way_merge(base: str, ours: str, theirs: str) -> MergeResult:
    """Line-based three-way merge.

    base   = original file content (before any agent touched it)
    ours   = current content on disk
    theirs = new content from the agent (artifact.modified_content)

    Returns MergeResult with merged content and conflict flags.
    """
    base_lines = base.splitlines(keepends=True)
    ours_lines = ours.splitlines(keepends=True)
    theirs_lines = theirs.splitlines(keepends=True)

    # No base available — fall back to two-way diff
    if not base_lines:
        return _two_way_merge(ours_lines, theirs_lines)

    matcher = SequenceMatcher(None, base_lines, theirs_lines)
    merged: list[str] = []
    has_conflicts = False
    conflict_count = 0
    ours_idx = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        base_chunk = base_lines[i1:i2]
        theirs_chunk = theirs_lines[j1:j2]

        if tag == "equal":
            # Unchanged in theirs → keep whatever is in ours for this region
            chunk_len = i2 - i1
            merged.extend(ours_lines[ours_idx:ours_idx + chunk_len])
            ours_idx += chunk_len

        elif tag == "replace":
            # Base→Theirs replaced this chunk. Try to apply same replacement to ours.
            ours_chunk = ours_lines[ours_idx:ours_idx + len(base_chunk)]
            ours_idx += len(base_chunk)

            sub_result = _apply_hunk(ours_chunk, base_chunk, theirs_chunk)
            merged.extend(sub_result.lines)
            if sub_result.conflict:
                has_conflicts = True
                conflict_count += 1

        elif tag == "delete":
            ours_chunk = ours_lines[ours_idx:ours_idx + len(base_chunk)]
            ours_idx += len(base_chunk)

            sub_result = _apply_hunk(ours_chunk, base_chunk, [])
            merged.extend(sub_result.lines)
            if sub_result.conflict:
                has_conflicts = True
                conflict_count += 1

        elif tag == "insert":
            # Theirs inserted new lines — insert before current ours position
            merged.extend(theirs_chunk)

    # Append any remaining lines from ours
    if ours_idx < len(ours_lines):
        merged.extend(ours_lines[ours_idx:])

    return MergeResult(
        merged_content="".join(merged),
        has_conflicts=has_conflicts,
        conflict_count=conflict_count,
    )


@dataclass
class _HunkResult:
    lines: list[str]
    conflict: bool = False


def _apply_hunk(ours: list[str], base: list[str], theirs: list[str]) -> _HunkResult:
    """Try to apply a change hunk (base→theirs) onto ours.

    If ours matches base exactly → cleanly apply theirs.
    If ours already matches theirs → nothing to do (already applied).
    Otherwise → write conflict markers.
    """
    if ours == base:
        return _HunkResult(lines=list(theirs))
    if ours == theirs:
        return _HunkResult(lines=list(ours))
    # Conflict — include all three versions
    lines: list[str] = []
    lines.append("<<<<<<< 当前文件\n")
    lines.extend(ours)
    lines.append("=======\n")
    lines.extend(theirs)
    lines.append(">>>>>>> Agent 生成的版本\n")
    return _HunkResult(lines=lines, conflict=True)


def _two_way_merge(ours: list[str], theirs: list[str]) -> MergeResult:
    """Fallback when no base is available — simple equality check."""
    if ours == theirs:
        return MergeResult(merged_content="".join(ours))
    if not ours:
        # No existing content — use theirs directly
        return MergeResult(merged_content="".join(theirs))
    matcher = SequenceMatcher(None, ours, theirs)
    if matcher.ratio() > 0.95:
        # Mostly the same — use theirs (newer) version
        return MergeResult(merged_content="".join(theirs))
    # Different enough to flag as conflict
    lines: list[str] = []
    lines.append("<<<<<<< 当前文件\n")
    lines.extend(ours)
    lines.append("=======\n")
    lines.extend(theirs)
    lines.append(">>>>>>> Agent 生成的版本\n")
    return MergeResult(
        merged_content="".join(lines),
        has_conflicts=True,
        conflict_count=1,
    )
