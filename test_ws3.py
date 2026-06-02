import asyncio, json, uuid, websockets

SID = 'fb3dcdf2-e6d7-4731-aeac-6cdb4542a015'
CODER = 'ecef41b1-58ee-4f3b-809b-9bdcde23975d'

async def main():
    uri = f'ws://localhost:8000/ws/{SID}?client_id={str(uuid.uuid4())}'
    async with websockets.connect(uri) as ws:
        # Send initial message
        await ws.send(json.dumps({
            'type': 'chat.send',
            'payload': {'content': '写一个纯HTML的网页倒计时工具。深色背景霓虹光效，用户输入目标日期时间，实时显示天时:分:秒倒计时，到零弹窗提醒。输出单个完整的countdown.html文件。'}
        }))
        print('=== SENT ===', flush=True)

        async for raw in ws:
            data = json.loads(raw)
            t = data['type']
            p = data.get('payload', {})

            if t == 'chat.message':
                safe = p.get('content','')[:200].encode('ascii','replace').decode('ascii')
                print(f'[MSG {p.get("role","?")}] {safe}', flush=True)

            elif t == 'plan.comparison':
                # Auto-select recommended approach
                for a in p.get('approaches', []):
                    if a.get('recommended'):
                        await ws.send(json.dumps({
                            'type': 'plan.action',
                            'payload': {'action': 'select_approach', 'approach_name': a['name']}
                        }))
                        print(f'=== SELECTED: {a["name"][:60]}', flush=True)
                        break

            elif t == 'plan.confirmed':
                tasks = p.get('tasks', [])
                print(f'=== CONFIRMED: {len(tasks)} tasks', flush=True)
                # Assign coder to all code tasks, reviewer to verify tasks
                assignments = []
                for tk in tasks:
                    cap = tk.get('required_capability', 'code')
                    assignments.append({
                        'task_id': tk['id'],
                        'agent_id': CODER,
                        'adapter_type': 'deepseek',
                    })
                await ws.send(json.dumps({
                    'type': 'plan.action',
                    'payload': {'action': 'confirm', 'assignments': assignments}
                }))
                print('=== ASSIGNED & CONFIRMED', flush=True)

            elif t == 'task.update':
                st = p.get('status','?')
                ti = p.get('title','?')[:60]
                rs = (p.get('result') or '')[:200].encode('ascii','replace').decode('ascii')
                err = (p.get('error') or '')
                print(f'[TASK {st}] {ti}', flush=True)
                if rs: print(f'  >> {rs}', flush=True)
                if err: print(f'  !! {err[:200]}', flush=True)

            elif t == 'artifact.created':
                fp = p.get('file_path','?')
                lang = p.get('language','?')
                prev = (p.get('content_preview','') or '')[:300].encode('ascii','replace').decode('ascii')
                print(f'[ARTIFACT] {fp} ({lang})', flush=True)
                if prev: print(f'  >> {prev}', flush=True)

            elif t == 'ping':
                await ws.send(json.dumps({'type': 'pong'}))

asyncio.run(main())
