const { chromium } = require('playwright');

const SESSION_ID = process.env.SESSION_ID;
const BASE = 'http://localhost:3000';
const CASE_DIR = process.env.CASE_DIR;
const TIMEOUT = parseInt(process.env.TIMEOUT || '600') * 1000;

if (!SESSION_ID || !CASE_DIR) {
  console.error('Usage: SESSION_ID=xxx CASE_DIR=... node tests/run-script.js');
  process.exit(1);
}

const fs = require('fs');

function now() { return new Date().toISOString(); }
function elapsed(t) { return Math.round((Date.now() - t) / 1000); }

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text && text.length < 500) consoleLogs.push(`[${msg.type()}] ${text}`);
  });

  async function ss(name) {
    const p = `${CASE_DIR}/screenshots/${name}.png`;
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    console.log(`SCREENSHOT: ${name}`);
  }

  // ===== Step 1: Load page =====
  console.log(`[${now()}] Navigating to`, BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await ss('01-page-loaded');

  // ===== Step 2: Activate session =====
  console.log(`[${now()}] Activating session:`, SESSION_ID);
  await page.evaluate((sid) => {
    const store = window.__CHAT_STORE__;
    if (store) store.getState().setActiveSession(sid);
  }, SESSION_ID);

  // Wait for WS ("在线")
  try {
    await page.waitForFunction(() => (document.body?.innerText || '').includes('在线'), { timeout: 15000 });
    console.log(`[${now()}] WS CONNECTED`);
  } catch (e) {
    console.log('WARN: WS not connected');
  }
  await ss('02-ws-connected');

  // ===== Step 3: Send message =====
  const firstMessage = '请计算 12345 × 6789，由一个Agent独立计算，另一个Agent独立验证结果';
  console.log(`[${now()}] Sending: ${firstMessage}`);

  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });
  await textarea.click();
  await textarea.fill('');
  await textarea.type(firstMessage, { delay: 10 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  console.log(`[${now()}] Message sent`);
  await ss('03-message-sent');

  // ===== Step 4: Monitor and interact =====
  const startTime = Date.now();
  let criticSpoke = false;
  let planCardClicked = false;
  let dagConfirmed = false;
  const taskStates = {}; // taskId -> { title, status, agentName, time }
  let lastMsgCount = 0;

  while (Date.now() - startTime < TIMEOUT) {
    await page.waitForTimeout(2000);

    // --- Read store ---
    let storeInfo;
    try {
      storeInfo = await page.evaluate(() => {
        const state = window.__CHAT_STORE__?.getState();
        if (!state) return null;
        const sid = state.activeSessionId;
        const msgs = sid ? (state.messages[sid] || []) : [];
        return {
          sessionId: sid,
          msgCount: msgs.length,
          lastMsg: msgs[msgs.length - 1] || null,
          allMsgs: msgs.map(m => ({ role: m.role, agentRole: m.agent_role || '', content: (m.content||'').substring(0, 200) })),
          currentPlan: state.currentPlan || null,
          confirmedPlans: state.confirmedPlans || {},
          tasks: sid ? (state.tasks[sid] || []) : [],  // TaskItem[]
          connectionStatus: state.connectionStatus
        };
      });
    } catch (e) {
      console.log(`[${now()}] evaluate error: ${e.message}`);
      break;
    }

    if (!storeInfo) continue;

    // --- Log new messages ---
    if (storeInfo.msgCount > lastMsgCount) {
      lastMsgCount = storeInfo.msgCount;
      const last = storeInfo.lastMsg;
      if (last) {
        const roleTag = last.agentRole ? `[${last.agentRole}]` : `[${last.role}]`;
        console.log(`[${elapsed(startTime)}s] MSG#${storeInfo.msgCount} ${roleTag} ${(last.content||'').substring(0, 120)}`);
      }
    }

    // --- Detect Critic ---
    if (!criticSpoke) {
      const allText = storeInfo.allMsgs.map(m => m.agentRole + ' ' + m.content).join(' ');
      if (allText.includes('Critic') || allText.includes('需求分析')) {
        criticSpoke = true;
        console.log(`[${elapsed(startTime)}s] CRITIC_SPOKE`);
        await ss('critic-response');
      }
    }

    // --- Step 4a: Click PlanCard if showing ---
    if (!planCardClicked) {
      // Check for plan phase comparison via store or DOM
      const planPhase = storeInfo.currentPlan?.phase;
      if (planPhase === 'comparison') {
        // Try clicking recommended plan or first plan button
        const planBtn1 = page.locator('button').filter({ hasText: /推荐|选择方案 1|选择方案1/i });
        if (await planBtn1.count() > 0) {
          await planBtn1.first().click();
          planCardClicked = true;
          console.log(`[${elapsed(startTime)}s] PLAN_CARD_CLICKED`);
          await ss('plan-selected');
        }
      }
    }

    // --- Step 4b: Click "确认执行" button ---
    if (!dagConfirmed) {
      const confirmBtn = page.locator('button').filter({ hasText: '确认执行' });
      const count = await confirmBtn.count();
      if (count > 0) {
        await confirmBtn.first().click();
        dagConfirmed = true;
        console.log(`[${elapsed(startTime)}s] DAG_CONFIRMED (clicked "确认执行")`);
        await ss('dag-confirmed');
      }
    }

    // --- Step 4c: Track tasks ---
    // storeInfo.tasks is TaskItem[] where TaskItem = { taskId, title, status, agent_name, ... }
    for (const t of (storeInfo.tasks || [])) {
      const key = t.taskId || t.title || 'unknown';
      if (!taskStates[key] || taskStates[key].status !== t.status) {
        taskStates[key] = { title: t.title, status: t.status, agentName: t.agent_name, time: now() };
        console.log(`[${elapsed(startTime)}s] TASK: ${t.title || key} -> ${t.status}`);
        await ss(`task-${key.replace(/[^a-zA-Z0-9一-鿿]/g, '-')}-${t.status}`);
      }
    }

    // --- Check completion ---
    const taskValues = Object.values(taskStates);
    if (dagConfirmed && taskValues.length > 0) {
      const allDone = taskValues.every(t =>
        ['done', 'completed'].includes((t.status || '').toLowerCase()));
      const planDone = storeInfo.currentPlan?.phase === 'done';

      // Also check for the "所有任务已完成" system message
      const doneMsg = (storeInfo.allMsgs || []).some(m =>
        m.content.includes('所有任务已完成') || m.content.includes('全部任务已完成'));

      if (allDone || planDone || doneMsg) {
        console.log(`[${elapsed(startTime)}s] ALL_DONE (allDone=${allDone} planDone=${planDone} doneMsg=${doneMsg})`);
        await ss('final');
        break;
      }
    }

    // --- Timeout check ---
    if (Date.now() - startTime >= TIMEOUT) {
      console.log(`[${elapsed(startTime)}s] TIMEOUT`);
      await ss('timeout');
    }
  }

  await ss('final-state');

  // ===== Save artifacts =====
  let fullStoreState = null;
  try {
    fullStoreState = await page.evaluate(() => {
      const state = window.__CHAT_STORE__?.getState();
      if (!state) return null;
      const sid = state.activeSessionId;
      return {
        sessionId: sid,
        messages: sid ? (state.messages[sid] || []) : [],
        currentPlan: state.currentPlan || null,
        confirmedPlans: state.confirmedPlans || {},
        tasks: sid ? (state.tasks[sid] || []) : [],
        connectionStatus: state.connectionStatus
      };
    });
  } catch (e) {
    console.log('Error reading final store state:', e.message);
  }

  fs.writeFileSync(`${CASE_DIR}/console.log`, consoleLogs.join('\n'), 'utf-8');
  fs.writeFileSync(`${CASE_DIR}/task-states.json`, JSON.stringify(taskStates, null, 2), 'utf-8');
  if (fullStoreState) {
    fs.writeFileSync(`${CASE_DIR}/store-snapshot.json`, JSON.stringify(fullStoreState, null, 2), 'utf-8');
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Critic spoke: ${criticSpoke}`);
  console.log(`Plan card clicked: ${planCardClicked}`);
  console.log(`DAG confirmed: ${dagConfirmed}`);
  console.log(`Tasks: ${JSON.stringify(taskStates, null, 2)}`);
  console.log(`Messages: ${fullStoreState?.messages?.length || 0}`);
  console.log(`Elapsed: ${elapsed(startTime)}s`);

  await browser.close();
  console.log('DONE');
})();
