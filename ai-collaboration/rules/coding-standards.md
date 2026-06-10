# 编码规范

> 来源：CLAUDE.md "编码约定" 章节 + 项目实际代码模式。这些规则 AI 每次对话自动加载。

## 通用原则（来自 CLAUDE.md）

- 默认不写注释。只在 WHY 不显然时加一行短注释
- 不处理不可能发生的错误场景
- 不做"未来可能需要"的抽象、接口层、配置项
- 中文注释，英文变量/函数名

## Python (FastAPI)

```yaml
异常处理: "except Exception，不裸 except:"
配置: "pydantic-settings 读取 .env"
数据库: "async SQLAlchemy，DB 操作通过 get_db 依赖注入"
WebSocket: "双协程模式 ws→eventbus + eventbus→ws"
Adapter: "方法全部 async，继承 base.py"
```

## TypeScript (Next.js)

```yaml
状态管理: "Zustand store，一个 domain 一个文件"
Selector: "不用 || []（导致无限渲染），用 EMPTY_ARRAY 常量"
Monaco: "必须 dynamic import {ssr: false}"
样式: "Tailwind + Shadcn CSS 变量，避免硬编码颜色"
WebSocket: "心跳 30s，重连指数退避 1s→2s→4s→8s→16s→30s"
```

## 项目约定（来自实际代码模式）

- 组件一个文件一个组件，hooks 一个文件一个 hook
- 硬编码 API key / secret 禁止（用 .env + AES-256-GCM 加密）
- 文件路径用绝对路径，不依赖相对路径
