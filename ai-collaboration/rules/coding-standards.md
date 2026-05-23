# 编码规范

## 通用原则

- 默认不写注释。只在 WHY 不显然时加一行短注释
- 不写多行 docstring
- 不为"未来可能需要"加抽象、接口层、配置项
- 三个相似的代码块比一个过早的抽象好
- 不处理不可能发生的错误场景

## Python (FastAPI)

- 使用 async SQLAlchemy (asyncpg 驱动)
- 所有 DB 操作通过 `get_db` 依赖注入
- WebSocket 路由用双协程模式 (ws→eventbus + eventbus→ws)
- Adapter 方法全部 async
- 配置用 `pydantic-settings` 读取环境变量

## TypeScript (Next.js)

- 组件文件一个组件一个文件
- Hooks 一个 hook 一个文件，放在 `hooks/` 下
- 状态管理用 Zustand store，每个 domain 一个 store
- Monaco Editor 组件必须 `dynamic import {ssr: false}`
- WebSocket 心跳 30s，重连用指数退避 (1s→2s→4s→max 30s)

## 禁止事项

- `any` 类型 (TypeScript)
- 裸 `except:` (Python)
- `console.log` 提交到 main
- 硬编码的 API key / secret
- CSS-in-JS (统一用 Tailwind + Shadcn 的 CSS variables)
