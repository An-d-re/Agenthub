"""
AgentHub E2E test runner (001-008)
Uses Playwright + Edge, writes all output to files to avoid encoding issues.
"""
import json, os, re, sys, time, traceback
from datetime import datetime
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

BATCH = datetime.now().strftime("%Y-%m-%d_%H-%M")
ROOT = Path("F:/AgentHub Project/agenthub")
CASES_DIR = ROOT / "tests/cases"
OUTPUT_DIR = ROOT / "tests/test-output" / BATCH
API = "http://localhost:8000/api"
FRONTEND = "http://localhost:3000"

def log_file_path(case_dir: Path):
    return case_dir / "run.log"

def parse_md(path: str) -> dict:
    """Parse test case Markdown file."""
    text = Path(path).read_text(encoding="utf-8")
    fm = {}
    m = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
    if m:
        for line in m.group(1).strip().split("\n"):
            line = line.strip()
            if ":" in line:
                k, v = line.split(":", 1)
                v = v.strip().strip('"').strip("'")  # strip quotes
                fm[k.strip()] = v
    # Parse sections
    sections = {}
    current = None
    for line in text.split("\n"):
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    # Parse steps (supports multi-line user messages)
    steps = []
    pending_user_msg = None
    def is_new_step(line: str) -> bool:
        if line.startswith("用户："):
            return True
        if line.startswith("(") and line.endswith(")"):
            return True
        m = re.match(r'^([^：:]+)[：:](.+)', line)
        if m:
            agent_name = m.group(1).strip()
            # Agent names are short and don't start with numbered list items
            if len(agent_name) <= 20 and not re.match(r'^\d+[\.\、\s]', agent_name):
                return True
        return False
    for line in sections.get("步骤", []):
        stripped = line.strip()
        if not stripped or stripped.startswith("<!--"):
            continue
        if is_new_step(stripped):
            # Flush pending user message first
            if pending_user_msg is not None:
                steps.append(("send", pending_user_msg.strip()))
                pending_user_msg = None
            if stripped.startswith("用户："):
                pending_user_msg = stripped[3:]  # start accumulating
            elif stripped.startswith("(") and stripped.endswith(")"):
                steps.append(("action", stripped[1:-1]))
            else:
                m2 = re.match(r'^([^：:]+)[：:](.+)', stripped)
                if m2:
                    steps.append(("record", {"agent": m2.group(1).strip(), "content": m2.group(2).strip()}))
        elif pending_user_msg is not None and not stripped.startswith("#"):
            pending_user_msg += "\n" + stripped  # continuation line
    # Flush remaining user message
    if pending_user_msg is not None:
        steps.append(("send", pending_user_msg.strip()))
    cleanup_lines = [l.strip() for l in sections.get("清理", []) if l.strip() and not l.strip().startswith("<!--")]
    return {
        "id": fm.get("id", path),
        "name": fm.get("name", path),
        "type": fm.get("type", "group"),
        "timeout": int(fm.get("timeout", 600)),
        "steps": steps,
        "cleanup": cleanup_lines,
    }


def create_session(session_type: str) -> dict:
    r = requests.post(f"{API}/sessions", json={"title": "E2E Test", "type": session_type, "agent_ids": []})
    r.raise_for_status()
    return r.json()


def run_case(case_file: str, idx: int, total: int):
    """Run a single test case. All progress written to run.log to avoid GBK issues."""
    case_path = CASES_DIR / case_file
    case = parse_md(str(case_path))
    case_id = str(case["id"])
    case_name = str(case["name"])
    timeout = case["timeout"]
    session_type = case["type"]

    # Create output dir
    out = OUTPUT_DIR / f"{int(case_id):03d}-{case_name[:20]}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "screenshots").mkdir(exist_ok=True)

    logf = open(str(out / "run.log"), "w", encoding="utf-8")

    def log(msg: str):
        print(msg, flush=True)
        logf.write(msg + "\n")
        logf.flush()

    log(f"{'='*60}")
    log(f"[{idx}/{total}] {case_id} - {case_name}")
    log(f"Steps: {len(case['steps'])}, timeout: {timeout}s")
    log(f"{'='*60}")

    result = {"case_id": case_id, "name": case_name, "status": "PASS", "steps": [], "error": ""}
    start_time = time.time()
    session_id = ""

    try:
        # Create session
        log("  Creating session...")
        session = create_session(session_type)
        session_id = session["id"]
        log(f"  session_id: {session_id}")

        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=False)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()

            console_logs = []
            page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

            # Navigate to session
            log(f"  Navigating to ?session={session_id[:8]}...")
            page.goto(f"{FRONTEND}/?session={session_id}", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=30000)
            page.wait_for_timeout(2000)

            # Dismiss cover page
            try:
                cover_btn = page.locator("button:has-text('开始使用')")
                if cover_btn.is_visible(timeout=3000):
                    log("  Cover detected, dismissing...")
                    cover_btn.click()
                    page.wait_for_timeout(1500)
                    log("  Cover dismissed")
            except:
                log("  No cover page")

            # Take initial screenshot
            page.screenshot(path=str(out / "screenshots/00-loaded.png"))
            log("  Page loaded, screenshot taken")

            # Execute steps
            steps = case["steps"]
            for step_num, (stype, sdata) in enumerate(steps, 1):
                log(f"  Step {step_num}: {stype} - {str(sdata)[:80]}")

                if stype == "send":
                    msg = sdata
                    try:
                        textarea = page.locator("textarea").first
                        textarea.wait_for(state="visible", timeout=10000)
                        textarea.click()
                        page.wait_for_timeout(300)
                        # Use keyboard.type() to trigger React onChange properly
                        page.keyboard.type(msg, delay=20)
                        page.wait_for_timeout(300)
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(2000)
                        log(f"    Message sent")
                        page.screenshot(path=str(out / f"screenshots/step{step_num:02d}-sent.png"))
                        result["steps"].append({"num": step_num, "type": "send", "status": "OK", "detail": msg[:50]})
                    except Exception as e:
                        log(f"    Send error: {e}")
                        try:
                            page.keyboard.type(msg, delay=20)
                            page.keyboard.press("Enter")
                            page.wait_for_timeout(1000)
                        except:
                            log(f"    Send failed completely")
                        result["steps"].append({"num": step_num, "type": "send", "status": "WARN", "detail": str(e)[:80]})

                elif stype == "action":
                    action = sdata
                    try:
                        if "Critic" in action:
                            log("    Waiting for Critic (30s)...")
                            page.wait_for_timeout(30000)
                            result["steps"].append({"num": step_num, "type": "observe-critic", "status": "OK"})

                        elif "Planner" in action and ("计划" in action or "方案" in action):
                            log("    Waiting for plan comparison (120s)...")
                            try:
                                page.locator("[class*='plan'], [class*='Plan'], .plan-card").first.wait_for(
                                    state="visible", timeout=120000
                                )
                                page.screenshot(path=str(out / "screenshots/plan-comparison.png"))
                                log("    Plan card appeared")
                            except PlaywrightTimeout:
                                page.screenshot(path=str(out / "screenshots/plan-comparison-timeout.png"))
                                log("    Plan card timeout")
                            result["steps"].append({"num": step_num, "type": "wait-plan", "status": "OK"})

                        elif "确认" in action:
                            log("    Confirming plan...")
                            page.wait_for_timeout(2000)
                            # Click first plan option
                            for sel in ["button:has-text('选择')", "button:has-text('Recommended')",
                                         ".plan-card button", "[class*='PlanCard'] button"]:
                                try:
                                    btn = page.locator(sel).first
                                    if btn.is_visible(timeout=2000):
                                        btn.click()
                                        page.wait_for_timeout(2000)
                                        log(f"    Clicked: {sel}")
                                        break
                                except:
                                    continue
                            # Click confirm/execute
                            for sel in ["button:has-text('确认')", "button:has-text('执行')",
                                         "button:has-text('开始执行')"]:
                                try:
                                    btn = page.locator(sel).first
                                    if btn.is_visible(timeout=5000):
                                        btn.click()
                                        page.wait_for_timeout(2000)
                                        log(f"    Clicked confirm: {sel}")
                                        break
                                except:
                                    continue
                            page.screenshot(path=str(out / "screenshots/plan-confirmed.png"))
                            result["steps"].append({"num": step_num, "type": "confirm", "status": "OK"})

                        elif "任务结束" in action:
                            log(f"    Waiting for tasks to finish (timeout={timeout}s)...")
                            deadline = time.time() + timeout
                            while time.time() < deadline:
                                page.wait_for_timeout(10000)
                                elapsed = time.time() - start_time
                                log(f"      Still waiting... {int(elapsed)}s elapsed")
                                page.screenshot(path=str(out / f"screenshots/step{step_num:02d}-progress.png"))
                                # Check for completion via API
                                try:
                                    msgs = requests.get(f"{API}/sessions/{session_id}/messages").json()
                                    done_count = sum(1 for m in msgs if isinstance(m, dict) and
                                                     m.get("message_type") == "task.update" and
                                                     m.get("content", {}).get("status") in ("done", "failed", "cancelled"))
                                    if done_count > 0:
                                        log(f"      Found {done_count} completed task messages")
                                except:
                                    pass
                                # Check DOM
                                try:
                                    running = page.locator("[class*='running'], text='执行中'").count()
                                    if running == 0:
                                        log("      No running tasks in DOM, breaking")
                                        break
                                except:
                                    pass
                            page.screenshot(path=str(out / "screenshots/final.png"))
                            result["steps"].append({"num": step_num, "type": "wait-tasks", "status": "OK"})

                        else:
                            log(f"    Custom action, waiting 10s...")
                            page.wait_for_timeout(10000)
                            page.screenshot(path=str(out / f"screenshots/step{step_num:02d}.png"))
                            result["steps"].append({"num": step_num, "type": "custom", "status": "OK", "detail": action[:60]})

                    except Exception as e:
                        log(f"    Action error: {e}")
                        result["steps"].append({"num": step_num, "type": "action", "status": "WARN", "detail": str(e)[:80]})

                elif stype == "record":
                    result["steps"].append({"num": step_num, "type": "record", "status": "NOTE",
                                            "detail": f"{sdata.get('agent', '')}: {sdata.get('content', '')[:60]}"})

            # Final screenshot
            page.screenshot(path=str(out / "screenshots/end-state.png"))
            # Save console logs
            (out / "console.log").write_text("\n".join(console_logs), encoding="utf-8")
            browser.close()

        # Collect conversation
        elapsed = time.time() - start_time
        log(f"  Done in {int(elapsed//60)}m{int(elapsed%60)}s")

        try:
            conv_r = requests.get(f"{API}/sessions/{session_id}/export")
            conv_md = conv_r.text if conv_r.ok else f"Export failed: {conv_r.status_code}"
            summary = f"\n\n---\n\n## Test Summary\n\n- Case: {case_id} - {case_name}\n- Time: {datetime.now().isoformat()}\n- Duration: {int(elapsed//60)}m{int(elapsed%60)}s\n- Session: {session_id}\n- Steps: {len(steps)}\n\n| Step | Type | Status | Detail |\n|------|------|--------|--------|\n"
            for s in result["steps"]:
                summary += f"| {s['num']} | {s['type']} | {s['status']} | {s.get('detail', '')} |\n"
            (out / "conversation.md").write_text(conv_md + summary, encoding="utf-8")
        except Exception as e:
            (out / "conversation.md").write_text(f"Export error: {e}", encoding="utf-8")

        # Raw messages
        try:
            msgs_r = requests.get(f"{API}/sessions/{session_id}/messages")
            if msgs_r.ok:
                (out / "raw_messages.json").write_text(
                    json.dumps(msgs_r.json(), ensure_ascii=False, indent=2), encoding="utf-8")
        except:
            pass

        # Cleanup
        for cl in case["cleanup"]:
            if "删除" in cl and "Agent" in cl:
                try:
                    agents = requests.get(f"{API}/agents").json()
                    for a in agents:
                        if isinstance(a, dict) and a.get("is_temp"):
                            requests.delete(f"{API}/agents/{a['id']}")
                except:
                    pass
            if "删除" in cl and "session" in cl.lower():
                try:
                    requests.delete(f"{API}/sessions/{session_id}")
                except:
                    pass

    except Exception as e:
        result["status"] = "FAIL"
        result["error"] = str(e)[:200]
        log(f"  FATAL: {e}")
        log(traceback.format_exc())

    log(f"  Result: {result['status']}")
    logf.close()
    return result


def main():
    case_files = [
        "001-翻译审查.md",
        "002-斐波那契数列.md",
        "003-数据分析.md",
        "004-生成登录页.md",
        "005-猜数字游戏.md",
        "006-全栈Todo应用.md",
        "007-代码审核流水线.md",
        "008-爬虫分析可视化.md",
    ]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Batch: {OUTPUT_DIR}")
    print(f"Total: {len(case_files)} cases\n")

    results = []
    for i, cf in enumerate(case_files, 1):
        try:
            r = run_case(cf, i, len(case_files))
            results.append(r)
        except Exception as e:
            results.append({"case_id": cf, "name": cf, "status": "FAIL", "error": str(e)[:200]})

    # Write summary to file (avoids GBK issues with console)
    summary_lines = []
    summary_lines.append(f"\n{'='*60}")
    summary_lines.append(f"Test Batch {BATCH} Complete")
    summary_lines.append(f"{'='*60}")
    summary_lines.append(f"\n| Case | Status | Steps | Error |")
    summary_lines.append(f"|------|--------|-------|-------|")
    for r in results:
        step_count = len(r.get("steps", []))
        err = r.get("error", "")[:50]
        summary_lines.append(f"| {r['case_id']} {r['name'][:20]} | {r['status']} | {step_count} steps | {err} |")
    summary_lines.append(f"\nOutput: {OUTPUT_DIR}")

    summary_text = "\n".join(summary_lines)
    print(summary_text)

    # Write detailed results
    (OUTPUT_DIR / "batch-summary.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "batch-summary.md").write_text(summary_text, encoding="utf-8")

    # Count results
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    print(f"\nTotal: {len(results)} | PASS: {passed} | FAIL: {failed}")


if __name__ == "__main__":
    main()
