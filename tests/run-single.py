"""
AgentHub single test case runner
Python script using Playwright with Edge, writes all logs to file to avoid encoding issues
"""
import json, os, sys, time, traceback
from datetime import datetime
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

BATCH = datetime.now().strftime("%Y-%m-%d_%H-%M")
ROOT = Path("F:/AgentHub Project/agenthub")
OUTPUT_DIR = ROOT / "tests/test-output" / BATCH
API = "http://localhost:8000/api"
FRONTEND = "http://localhost:3000"
LOG_FILE = None

def log(msg: str):
    print(msg, flush=True)
    if LOG_FILE:
        LOG_FILE.write(msg + "\n")
        LOG_FILE.flush()

def run_case(case_file: str):
    global LOG_FILE

    case_path = ROOT / "tests/cases" / case_file
    text = case_path.read_text(encoding="utf-8")
    lines = text.split("\n")

    # Parse frontmatter
    case_id = "???"
    case_name = "???"
    timeout = 600
    session_type = "group"
    in_fm = False
    for line in lines:
        if line.strip() == "---":
            if not in_fm:
                in_fm = True
                continue
            else:
                break
        if in_fm:
            if line.startswith("id:"):
                case_id = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("name:"):
                case_name = line.split(":", 1)[1].strip()
            elif line.startswith("type:"):
                session_type = line.split(":", 1)[1].strip()
            elif line.startswith("timeout:"):
                try:
                    timeout = int(line.split(":", 1)[1].strip())
                except:
                    pass

    # Parse steps: lines in ## steps section that are user messages or actions
    steps = []
    in_steps = False
    for line in lines:
        if line.startswith("## ") and "步骤" in line:
            in_steps = True
            continue
        if line.startswith("## ") and in_steps:
            in_steps = False
            continue
        if in_steps:
            s = line.strip()
            if s.startswith("用户："):
                steps.append(("send", s[3:]))
            elif s.startswith("(") and s.endswith(")"):
                steps.append(("action", s[1:-1]))

    out_dir = OUTPUT_DIR / f"0{case_id}-{case_name[:15]}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "screenshots").mkdir(exist_ok=True)

    LOG_FILE = open(str(out_dir / "run.log"), "w", encoding="utf-8")

    log(f"{'='*60}")
    log(f"Test: {case_id} — {case_name}")
    log(f"Steps: {len(steps)}")
    log(f"{'='*60}")

    start_time = time.time()
    session_id = ""
    result = {"case_id": case_id, "name": case_name, "status": "PASS", "session_id": "", "steps": [], "error": ""}

    try:
        # Create session
        log("Creating session...")
        r = requests.post(f"{API}/sessions", json={"title": f"E2E-{case_id}", "type": session_type, "agent_ids": []})
        r.raise_for_status()
        session = r.json()
        session_id = session["id"]
        result["session_id"] = session_id
        log(f"Session: {session_id}")

        # Open browser
        log("Opening browser...")
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=False)
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            log(f"Navigating to ?session={session_id}...")
            page.goto(f"{FRONTEND}/?session={session_id}", timeout=30000)
            page.wait_for_load_state("networkidle", timeout=30000)
            page.wait_for_timeout(2000)

            # Dismiss cover page if present (new browser context has no sessionStorage)
            try:
                cover_btn = page.locator("button:has-text('开始使用')")
                if cover_btn.is_visible(timeout=3000):
                    log("Cover page detected, clicking dismiss...")
                    cover_btn.click()
                    page.wait_for_timeout(1500)  # wait for dissolve animation
                    log("Cover dismissed")
            except:
                log("No cover page (already dismissed or not present)")

            # Screenshot: page loaded
            page.screenshot(path=str(out_dir / "screenshots/00-loaded.png"))
            log("Page loaded, screenshot taken")

            for i, (stype, sdata) in enumerate(steps, 1):
                log(f"Step {i}: {stype} — {sdata[:80]}")

                if stype == "send":
                    # Type message into textarea
                    try:
                        textarea = page.locator("textarea").first
                        textarea.wait_for(state="visible", timeout=10000)
                        textarea.click()
                        textarea.fill(sdata)
                        page.wait_for_timeout(500)
                        # Send with Enter
                        page.keyboard.press("Enter")
                        log(f"  Message sent")
                        page.screenshot(path=str(out_dir / f"screenshots/step{i:02d}-sent.png"))
                    except Exception as e:
                        log(f"  Send error: {e}")
                        # Try alternative: click the send button area
                        try:
                            page.keyboard.type(sdata)
                            page.keyboard.press("Enter")
                            log(f"  Message sent (fallback)")
                        except:
                            log(f"  Send failed completely")

                elif stype == "action":
                    action = sdata
                    if "Critic" in action:
                        log("  Waiting for Critic (30s)...")
                        page.wait_for_timeout(30000)

                    elif "Planner" in action and ("计划" in action or "方案" in action):
                        log("  Waiting for plan comparison (120s)...")
                        try:
                            page.wait_for_selector('[class*="plan"], [class*="Plan"], [class*="card"]', timeout=120000)
                            page.wait_for_timeout(2000)
                            page.screenshot(path=str(out_dir / "screenshots/plan-comparison.png"))
                            log("  Plan card appeared")
                        except:
                            log("  Plan card timeout, taking screenshot anyway")
                            page.screenshot(path=str(out_dir / "screenshots/plan-timeout.png"))

                    elif "确认" in action:
                        log("  Clicking confirm...")
                        page.wait_for_timeout(3000)
                        # Try to find and click any confirm/select button
                        for sel in ["button:has-text('选择')", "button:has-text('确认')", "button:has-text('执行')",
                                     ".plan-card button", "[class*='PlanCard'] button", "button:has-text('Recommended')"]:
                            try:
                                btn = page.locator(sel).first
                                if btn.is_visible(timeout=2000):
                                    btn.click()
                                    page.wait_for_timeout(2000)
                                    log(f"  Clicked: {sel}")
                                    break
                            except:
                                continue
                        page.screenshot(path=str(out_dir / f"screenshots/step{i:02d}-confirm.png"))

                    elif "任务结束" in action:
                        log(f"  Waiting for tasks to finish (timeout={timeout}s)...")
                        deadline = time.time() + timeout
                        while time.time() < deadline:
                            page.wait_for_timeout(10000)
                            elapsed = time.time() - start_time
                            log(f"    Still waiting... {int(elapsed)}s elapsed")
                            page.screenshot(path=str(out_dir / f"screenshots/step{i:02d}-progress.png"))
                        page.screenshot(path=str(out_dir / "screenshots/final.png"))
                        log("  Task wait finished")

                    else:
                        log(f"  Custom action, waiting 10s...")
                        page.wait_for_timeout(10000)
                        page.screenshot(path=str(out_dir / f"screenshots/step{i:02d}.png"))

            # Final
            page.screenshot(path=str(out_dir / "screenshots/end-state.png"))
            browser.close()

        # Collect conversation
        elapsed = time.time() - start_time
        log(f"\nDone in {int(elapsed//60)}m{int(elapsed%60)}s")

        try:
            conv_r = requests.get(f"{API}/sessions/{session_id}/export")
            conv_md = conv_r.text if conv_r.ok else f"Export failed: {conv_r.status_code}"
            summary = f"\n\n---\n\n## Summary\n- Case: {case_id} — {case_name}\n- Time: {datetime.now().isoformat()}\n- Duration: {int(elapsed//60)}m{int(elapsed%60)}s\n- Session: {session_id}\n- Steps: {len(steps)}\n"
            (out_dir / "conversation.md").write_text(conv_md + summary, encoding="utf-8")
        except Exception as e:
            (out_dir / "conversation.md").write_text(f"Export error: {e}", encoding="utf-8")

        try:
            msgs_r = requests.get(f"{API}/sessions/{session_id}/messages")
            if msgs_r.ok:
                (out_dir / "raw_messages.json").write_text(json.dumps(msgs_r.json(), ensure_ascii=False, indent=2), encoding="utf-8")
        except:
            pass

    except Exception as e:
        result["status"] = "FAIL"
        result["error"] = str(e)
        log(f"\nFATAL ERROR: {e}")
        log(traceback.format_exc())

    log(f"\nResult: {result['status']}")
    if LOG_FILE:
        LOG_FILE.close()
    return result

if __name__ == "__main__":
    case_file = sys.argv[1] if len(sys.argv) > 1 else "001-翻译审查.md"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    r = run_case(case_file)
    print(f"\nFinal: {r['case_id']} — {r['status']}")
