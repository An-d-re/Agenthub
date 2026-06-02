# QA Report: AgentHub

**URL:** http://localhost:8000 (backend), http://localhost:3000 (frontend)
**Date:** 2026-06-02
**Duration:** ~15 min
**Mode:** Full (API testing + static code analysis)
**Framework detected:** FastAPI (backend) + Next.js 14 (frontend)
**Pages visited:** 11 REST endpoints tested; frontend loads (200)
**Screenshots:** 0 (browse tool setup unavailable — API-level testing only)

---

## Health Score

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | N/A | 15% | — |
| Links | N/A | 10% | — |
| Visual | N/A | 10% | — |
| Functional | 50 | 20% | 10.0 |
| UX | 60 | 15% | 9.0 |
| Performance | N/A | 10% | — |
| Content | N/A | 5% | — |
| Accessibility | N/A | 15% | — |

**Functional Score: 50/100** — 3 of 11 tested endpoints return 500 Internal Server Error.

**Overall Health: 3.8/10** (weighted average of measurable categories)

> No test framework detected. Run `/qa` to bootstrap one and enable regression test generation.

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 2 |
| Medium | 3 |
| Low | 3 |
| Design | 3 |

---

## Critical Findings

### [CRITICAL] ISSUE-001 — DB Schema Mismatch: Agent model columns missing from SQLite table

**Confidence:** 10/10 (verified by reading DB schema + model + API response)

**Evidence:**
- Agent model (`backend/app/models/agent.py:23-24`) defines `is_temp` (Boolean) and `encrypted_api_key` (Text)
- SQLite table `agents` has only 9 columns: `id, name, avatar_url, role_type, adapter_type, system_prompt, skills, capability_tags, is_deletable`
- `is_temp` and `encrypted_api_key` are missing from the actual DB

**Impact:** Every endpoint that loads Agent objects from DB returns 500 Internal Server Error:
- `GET /api/agents` → 500
- `GET /api/sessions/{id}` → 500 (via `_build_session_response` → `db.get(Agent, ...)`)
- `GET /api/sessions/{id}/export` → 500 (via `db.get(Agent, ...)`)
- `POST /api/sessions` (group with system agents) → likely 500
- All orchestrator task execution (via `match_task_to_agent` → `db.get(Agent, ...)`)
- All agent factory operations (`create_temp_agent`, `destroy_temp_agents`)

**Root cause:** `init_db()` uses `Base.metadata.create_all()` which only creates NEW tables and does not ALTER existing ones. The Agent model was updated with new columns after the DB was initialized.

---

### [CRITICAL] ISSUE-002 — Orchestrator runs as fire-and-forget task with no error visibility to user

**Confidence:** 9/10 (verified by reading ws_routes.py:162)

**Evidence:** `ws_routes.py:159-162`:
```python
async def _run_orch():
    try:
        await Orchestrator(session_id).handle_message(content, mentions=mentions)
    except Exception as e:
        logger.exception("Orchestrator task CRASH session=%s: %s", session_id, e)
asyncio.create_task(_run_orch())
```

**Impact:** The orchestrator runs as `create_task()` after the user message is already acknowledged. If the orchestrator crashes (e.g., due to ISSUE-001's DB schema mismatch when loading agents), the error is only logged server-side. The user sees their message sent successfully but never gets a response — a silent failure with no feedback.

---

### [CRITICAL] ISSUE-003 — `AgentFactory.match_task_to_agent` and all Agent-loading code broken by ISSUE-001

**Confidence:** 10/10 (verified by reading agent_factory.py)

**Evidence:** `agent_factory.py:97`:
```python
agent = await db.get(Agent, aid)
```

And `agent_factory.py:194`:
```python
agent = await db.get(Agent, sa.agent_id)
```

**Impact:** All task execution in group chats is completely broken. No agent can be matched to tasks, no temporary agents can be created or destroyed. The entire orchestrator execution path is non-functional.

---

## High Findings

### [HIGH] ISSUE-004 — SubagentLimiter never acquires semaphore in middleware chain

**Confidence:** 8/10 (verified by reading middleware.py:232-261)

**Evidence:** `middleware.py:239-248`:
```python
sem = self._semaphores[sid]
if sem.locked():
    ...
if sem.locked():
    ...
return ctx
```

The `process()` method calls `sem.locked()` to check capacity but never calls `sem.acquire()`. The `acquire()`/`release()` methods exist (lines 263-271) but are only called externally. The middleware chain itself doesn't enforce concurrency — it depends on the executing phase to call acquire/release manually.

**Impact:** If the executing phase doesn't properly call acquire/release (or if those calls are omitted in edge cases), there's no concurrency limit enforcement and too many agents may run simultaneously, potentially exhausting API rate limits.

---

### [HIGH] ISSUE-005 — Private attribute access on ConnectionManager

**Confidence:** 8/10 (verified by reading ws_routes.py:73)

**Evidence:** `ws_routes.py:72-76`:
```python
remaining = any(
    sid == session_id for sid in manager._client_sessions.values()
)
```

Accesses `manager._client_sessions` (a private attribute with underscore prefix) from outside the ConnectionManager class. This breaks encapsulation and will silently break if ConnectionManager's internal representation changes.

**Fix:** Add a public method `ConnectionManager.has_session_clients(session_id) -> bool`.

---

## Medium Findings

### [MEDIUM] ISSUE-006 — `init_db` uses `create_all` which doesn't migrate existing tables

**Confidence:** 9/10

**Evidence:** `database.py:33`: `await conn.run_sync(Base.metadata.create_all)`

SQLAlchemy's `create_all` skips tables that already exist — it never adds columns to existing tables. When the Agent model was updated to add `is_temp` and `encrypted_api_key`, these changes were never applied to the live database.

Alembic is configured (`alembic.ini` exists, one migration at `08c57b00c04d_initial_schema.py`) but no migration was created for the Agent model changes.

---

### [MEDIUM] ISSUE-007 — Session export writes files to unversioned `test-cases/` directory

**Confidence:** 7/10

**Evidence:** `sessions.py:272-278`:
```python
backend_dir = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
test_cases_dir = _os.path.join(_os.path.dirname(backend_dir), "test-cases")
_os.makedirs(test_cases_dir, exist_ok=True)
filepath = _os.path.join(test_cases_dir, filename)
with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
```

The `test-cases/` directory is not in `.gitignore`. Every session export writes a file to this directory, which will accumulate over time and could be accidentally committed.

---

### [MEDIUM] ISSUE-008 — `send_personal` catches all Exceptions and silently disconnects

**Confidence:** 6/10

**Evidence:** `connection_manager.py:53-59`:
```python
async def send_personal(self, message, client_id):
    ws = self._connections.get(client_id)
    if ws and ws.client_state == WebSocketState.CONNECTED:
        try:
            await ws.send_text(json.dumps(message, default=str))
        except Exception:
            await self.disconnect(client_id)
```

Any send failure (even transient ones) immediately disconnects the client. There's no distinction between a permanent connection failure and a temporary issue like a full send buffer.

---

## Low Findings

### [LOW] ISSUE-009 — WAL PRAGMA configured twice at startup

**Evidence:** `database.py:17-21` (connect event listener) and `database.py:35-36` (explicit PRAGMA in init_db). Both set WAL mode and busy_timeout. Harmless but indicates defensive redundancy from debugging.

---

### [LOW] ISSUE-010 — `import asyncio` inside method body

**Evidence:** `middleware.py:233`: `import asyncio` inside `SubagentLimiter.process()`. Should be at module level (asyncio is already imported at line 232's level in ws_routes, but here it's in the middleware module where asyncio isn't imported at the top).

---

### [LOW] ISSUE-011 — LoopDetector comment/code mismatch

**Evidence:** `middleware.py:175`: Comment says "连续2轮" (2 consecutive rounds) but the code at line 197 triggers at `count >= 3` (3 occurrences).

---

## Design Issues

### [DESIGN] ISSUE-012 — No test infrastructure

`backend/tests/` directory exists but is empty. No test framework configuration found. No frontend tests either. A project of this complexity (12 DB tables, WebSocket protocol, 4-phase state machine, multi-adapter architecture) has zero automated tests.

### [DESIGN] ISSUE-013 — Agent model evolution without migration strategy

The project has Alembic configured but doesn't use it for schema changes. The `create_all` approach in `init_db()` works for first-time setup but silently breaks when models change. Every developer with an existing DB will hit ISSUE-001.

### [DESIGN] ISSUE-014 — ErrorBoundary component defined but never mounted

`frontend/src/components/ErrorBoundary.tsx` is defined but neither `layout.tsx` nor `page.tsx` wraps any component tree with it. If a React component throws during render, the entire app will show a blank white screen instead of the graceful fallback UI the ErrorBoundary provides.

---

## REST API Test Results

| Endpoint | Method | Status | Result |
|----------|--------|--------|--------|
| `/api/health` | GET | 200 | `{"status":"ok","version":"0.1.0"}` |
| `/api/agents` | GET | **500** | Internal Server Error |
| `/api/sessions` | GET | 200 | 16 sessions returned |
| `/api/sessions/{id}` | GET | **500** | Internal Server Error (loads Agent via `_build_session_response`) |
| `/api/sessions/{id}/messages` | GET | 200 | Messages returned correctly |
| `/api/sessions/{id}/export` | GET | **500** | Internal Server Error (loads Agent via `db.get(Agent, ...)`) |
| `/api/models/available` | GET | 200 | 3 adapters listed (deepseek available, anthropic/opencode need key) |
| `/api/deployments` | GET | 200 | `[]` (empty, correct) |
| `/api/traces` | GET | 200 | `[]` (empty, correct) |
| `/api/artifacts` | GET | 200 | `[]` (empty, correct) |
| Frontend | GET | 200 | Page loads |

**3 of 11 endpoints return 500.** Success rate: 73%.

---

## Top 3 Things to Fix

1. **ISSUE-001 (DB Schema Mismatch)** — Add `is_temp` and `encrypted_api_key` columns to the agents table. This is a single-table fix that unblocks all other functionality. Run: `ALTER TABLE agents ADD COLUMN is_temp BOOLEAN DEFAULT 0; ALTER TABLE agents ADD COLUMN encrypted_api_key TEXT;`

2. **ISSUE-002 (Silent orchestrator failures)** — When the orchestrator crashes in `create_task`, publish an error message to the EventBus so the user sees "任务处理失败" in the chat instead of silence.

3. **ISSUE-012 (Zero tests)** — Add at minimum a smoke test that exercises the health endpoint and a test that creates an agent via REST API. Without tests, issues like ISSUE-001 go undetected until manual QA.

---

## Appendix: DB Table Row Counts

| Table | Rows |
|-------|------|
| agents | 5 |
| sessions | 16 |
| session_agents | 54 |
| messages | 156 |
| plans | 23 |
| tasks | 4 |
| task_dependencies | 4 |
| artifacts | 0 |
| traces | 0 |
| deployments | 0 |
| pinned_messages | 0 |
| user_settings | 0 |

---

*Report generated by /qa-only. No fixes applied.*
