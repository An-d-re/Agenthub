import asyncio, json, uuid

async def main():
    # Create a fresh session first
    import httpx
    async with httpx.AsyncClient() as client:
        # Get agents
        r = await client.get('http://localhost:8000/api/agents')
        agents = r.json()
        agent_ids = [a['id'] for a in agents[:4]]

        # Create new group session
        r = await client.post('http://localhost:8000/api/sessions', json={
            'title': '倒计时工具',
            'type': 'group',
            'agent_ids': agent_ids,
        })
        session = r.json()
        session_id = session['id']
        print(f'Created session: {session_id}', flush=True)

    import websockets
    client_id = str(uuid.uuid4())
    uri = f'ws://localhost:8000/ws/{session_id}?client_id={client_id}'

    async with websockets.connect(uri) as ws:
        msg = {
            'type': 'chat.send',
            'payload': {
                'content': '写一个网页倒计时工具。用户输入未来的日期时间，显示天/时/分/秒倒计时，到零弹窗。深色霓虹科技风，纯单页HTML。'
            }
        }
        await ws.send(json.dumps(msg))
        print('SENT', flush=True)

        try:
            while True:
                resp = await asyncio.wait_for(ws.recv(), timeout=120.0)
                data = json.loads(resp)
                t = data.get('type', '')
                p = data.get('payload', {})

                if t == 'chat.message':
                    r = p.get('role', '?')
                    c = p.get('content', '')
                    print(f'[{r}] {c[:500]}', flush=True)

                elif t == 'chat.stream.token':
                    print(p.get('token', ''), end='', flush=True)

                elif t == 'artifact.created':
                    fp = p.get('file_path', '?')
                    print(f'\n[ARTIFACT] {fp} lang={p.get("language", "?")}', flush=True)
                    # Print the preview content
                    preview = p.get('content_preview', '')
                    if preview:
                        print(f'  Content preview: {preview[:300]}', flush=True)

                elif t == 'plan.comparison':
                    approaches = p.get('approaches', [])
                    print(f'\n[PLAN] {len(approaches)} approaches', flush=True)
                    for a in approaches:
                        print(f'  - {a.get("name","?")}: {a.get("summary","")[:120]}', flush=True)
                        if a.get('recommended'):
                            await ws.send(json.dumps({
                                'type': 'plan.action',
                                'payload': {'action': 'select_approach', 'approach_name': a['name']}
                            }))
                            print(f'  -> Auto-selected: {a["name"]}', flush=True)

                elif t == 'plan.confirmed':
                    tasks = p.get('tasks', [])
                    print(f'\n[CONFIRMED] {len(tasks)} tasks', flush=True)
                    for tk in tasks:
                        print(f'  - {tk.get("title","?")} [cap:{tk.get("required_capability","?")}]', flush=True)
                    await ws.send(json.dumps({
                        'type': 'plan.action',
                        'payload': {'action': 'confirm', 'assignments': []}
                    }))
                    print('  -> Auto-confirmed', flush=True)

                elif t == 'task.update':
                    print(f'\n[TASK] {p.get("title","?")} -> {p.get("status","?")}', flush=True)
                    if p.get('result'):
                        print(f'  Result: {p["result"][:300]}', flush=True)

                elif t == 'ping':
                    await ws.send(json.dumps({'type': 'pong'}))

        except asyncio.TimeoutError:
            print('\n[DONE - timeout]', flush=True)

asyncio.run(main())
