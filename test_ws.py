import asyncio, json, uuid, sys
import websockets

async def main():
    session_id = '30c07d20-80c5-4d1c-879f-564bc485d245'
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
                resp = await asyncio.wait_for(ws.recv(), timeout=90.0)
                data = json.loads(resp)
                t = data.get('type', '')
                p = data.get('payload', {})

                if t == 'chat.message':
                    r = p.get('role', '?')
                    c = p.get('content', '')
                    print(f'[{r}] {c[:400]}', flush=True)

                elif t == 'chat.stream.token':
                    print(p.get('token', ''), end='', flush=True)

                elif t == 'artifact.created':
                    print(f'\n[ARTIFACT] {p.get("file_path", "?")} lang={p.get("language", "?")}', flush=True)

                elif t == 'plan.comparison':
                    approaches = p.get('approaches', [])
                    print(f'[PLAN] {len(approaches)} approaches', flush=True)
                    for a in approaches:
                        if a.get('recommended'):
                            await ws.send(json.dumps({
                                'type': 'plan.action',
                                'payload': {'action': 'select_approach', 'approach_name': a['name']}
                            }))
                            print(f'  -> selected: {a["name"]}', flush=True)

                elif t == 'plan.confirmed':
                    tasks = p.get('tasks', [])
                    print(f'[CONFIRMED] {len(tasks)} tasks', flush=True)
                    await ws.send(json.dumps({
                        'type': 'plan.action',
                        'payload': {'action': 'confirm', 'assignments': []}
                    }))
                    print('  -> confirmed', flush=True)

                elif t == 'task.update':
                    print(f'[TASK] {p.get("title","?")} -> {p.get("status","?")}', flush=True)

                elif t == 'ping':
                    await ws.send(json.dumps({'type': 'pong'}))

        except asyncio.TimeoutError:
            print('\n[DONE]', flush=True)

asyncio.run(main())
