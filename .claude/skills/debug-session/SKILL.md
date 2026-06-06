---
name: debug-session
description: AgentHub group chat session diagnostic skill. Use when the user reports "task didn't execute", "Agent didn't reply", "stuck in phase", or any unexpected orchestration behavior. Gathers diagnostics API + orchestrator log, cross-references, and produces a root-cause report.
---

<what-to-do>

The user is reporting unexpected behavior in an AgentHub group chat session. Your job is to gather diagnostics and identify the root cause.

Ask the user for the **session ID** if they haven't provided it. (They can find it in the test-case Markdown file header: `会话 ID：xxx`.)

</what-to-do>

<diagnostic-procedure>

## Step 1: Gather raw data

Run these in parallel (Bash tool):

```
# 1. Diagnostics API — full internal state
curl -s "http://localhost:8000/api/sessions/{session_id}/diagnostics" | python -m json.tool

# 2. Orchestrator log — only lines for this session
grep "{session_id_short}" "F:/AgentHub Project/agenthub/backend/logs/orchestrator.log" | tail -50
```

(session_id_short = first 8 chars of the UUID)

## Step 2: Cross-reference checklist

Go through this checklist. For each mismatch you find, that's a potential root cause.

### A. Phase progression
- Does `plan.phase` match the expected phase?
- Check the log for `>>> 进入阶段` and `--> 自动推进` lines
- If stuck at `clarify` with no agents → Bug C (no-agent loop). `clarify_round` should auto-advance after 2.
- If stuck at `confirmed` → DAG was sent to frontend but user never confirmed (or confirm_plan crashed)

### B. DAG vs TaskDB consistency
- Compare `plan.dag` items against `tasks` array
- Each DAG entry should have a matching TaskDB entry (by title)
- If `dag_length > 0` but `tasks` is empty → DAG persisted but Task records never created (Bug A: `td is None` in loop)
- If `_db_id` is missing in DAG → Task creation partial failure

### C. Task dependency chain
- Check `dependencies` array: each `depends_on` should match a task `db_id`
- In the log, look for:
  - `调度: 执行 N 个就绪任务` — how many rounds of execution?
  - `not all done, re-running for next batch` — did the recursive scheduling work?
  - If only ONE execution round but `tasks` has pending items → **MissingGreenlet bug** (the recursive call crashed)

### D. Agent assignments
- Each task with `assigned_agent_id = null` in TaskDB is orphaned
- Check `agents` array: temp agents should have matching `capability_tags` for their assigned task
- If agent was created (in log: `Created temp agent`) but task still has `assigned: NONE` → confirm_with_assignments didn't persist the assignment

### E. Error signals in log
- `MissingGreenlet` → the aiosqlite/greenlet crash we fixed (executing.py: ctx.plan refresh after commit)
- `Task exception was never retrieved` → exception swallowed in background asyncio.Task
- `_decompose: 跳过非 dict` → LLM returned null/invalid items in JSON array
- `没有可用的 Agent` → session has 0 agents, auto-creation failed

## Step 3: Produce report

Format:
```
## 诊断报告 — Session {id}

**当前状态**: phase={phase}, status={status}
**任务进度**: {done_count}/{total_count} 完成

**发现的问题**:
1. [问题描述] → [根因] → [修复建议]

**日志关键事件**:
- HH:MM:SS 事件1
- HH:MM:SS 事件2
```

If you find a bug in the code (not just configuration/user error), offer to fix it.

</diagnostic-procedure>

<known-failure-patterns>

These are bugs we've already encountered and fixed. If symptoms match, check whether the fix is actually deployed.

| Pattern | Symptom | Root Cause | Fix |
|---------|---------|------------|-----|
| **MissingGreenlet** | task-2 stuck in pending, no error visible in UI | `ctx.plan.session_id` accessed after `commit()` expires non-PK attributes; aiosqlite lazy-load fails in wrong greenlet | executing.py: cache session_id + refresh plan after commit |
| **NoneType in DAG loop** | `'NoneType' object is not subscriptable` at confirmed.py | LLM returns `[null, {...}]` in JSON; `td is None` in for loop | Added `isinstance(td, dict)` guard before accessing td keys |
| **Stale pyc** | Fix deployed but old behavior persists | Windows `pkill` can't kill native Python; stale `.pyc` survives restart | `taskkill //F //IM python.exe` + clear `__pycache__` |
| **No-agent infinite loop** | "请添加 Agent" repeats forever | `clarify_round` was stored in `task_dag` dict; never incremented when no agent | Dedicated `clarify_round` Integer column |
| **Type mixing in task_dag** | `task_dag` sometimes dict, sometimes list | Clarify stored `{"clarify_round": N}`, confirmed stored `[{...}]` | `clarify_round` moved to own column |

</known-failure-patterns>
