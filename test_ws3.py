import asyncio, json, uuid, httpx, websockets

CODER = 'ecef41b1-58ee-4f3b-809b-9bdcde23975d'

async def main():
    # Create SINGLE-chat session (bypasses orchestrator, faster)
    async with httpx.AsyncClient() as h:
        r = await h.post('http://localhost:8000/api/sessions', json={
            'title': 'Countdown',
            'type': 'single',
            'agent_ids': [CODER],
        })
        sid = r.json()['id']
    print(f'Session: {sid}', flush=True)

    uri = f'ws://localhost:8000/ws/{sid}?client_id={str(uuid.uuid4())}'
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({
            'type': 'chat.send',
            'payload': {'content': '写一个网页倒计时工具。要求：\n1. 深色背景(#0a0a0a)霓虹光效风格\n2. 用户用datetime-local输入目标时间\n3. 实时显示天:时:分:秒倒计时\n4. 到零弹出自定义模态框提醒\n5. 用单个完整的HTML文件输出\n\n请直接输出完整的HTML代码，放在```html代码块中。'}
        }))
        print('=== SENT ===', flush=True)

        code_buffer = []
        in_code = False
        async for raw in ws:
            data = json.loads(raw); t = data['type']; p = data.get('payload', {})

            if t == 'chat.stream.token':
                tok = p.get('token', '')
                print(tok, end='', flush=True)
                if '```html' in tok:
                    in_code = True; code_buffer = []
                elif in_code and '```' in tok and tok != '```html':
                    in_code = False
                elif in_code:
                    code_buffer.append(tok)

            elif t == 'artifact.created':
                fp = p.get('file_path', '?')
                prev = (p.get('content_preview', '') or '')[:200]
                print(f'\n[ARTIFACT] {fp}', flush=True)

            elif t == 'chat.message':
                role = p.get('role','?')
                if role == 'agent':
                    print('\n=== DONE ===', flush=True)
                    break

            elif t == 'ping':
                await ws.send(json.dumps({'type': 'pong'}))

    # Check workspace
    import os
    wsp = f'C:/Users/xlx/projects/agent_hub/backend/workspaces/{sid}'
    if os.path.exists(wsp):
        for f in os.listdir(wsp):
            path = os.path.join(wsp, f)
            size = os.path.getsize(path)
            print(f'FILE: {f} ({size} bytes)', flush=True)
            if f.endswith('.html'):
                print(open(path).read()[:500], flush=True)

asyncio.run(main())
