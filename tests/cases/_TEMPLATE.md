---
id: template
name: 测试用例名称
type: group           # group（群聊）或 single（单聊）
timeout: 600          # 秒，默认 600（10分钟），可省略
---

## 设置
<!--
  需要提前创建的 Agent（名称 + 角色），没有则不写。
  未列出的 Agent 由 Planner 在对话中自动创建/匹配。
  示例：
  - Calculator / Coder（提前创建计算Agent）
  - Verifier / Reviewer（提前创建验证Agent）
-->

## 步骤
<!--
  混合格式：括号 = 行为指令，无括号 = 对话记录（仅记录，不做匹配验证）

  每个用例会自动创建新的 Session，第一条"用户："消息触发测试开始。

  写法示例：
    用户：这是一条要发送的消息
    (等待 PlanCard 出现后点击第一个方案)
    (等待所有任务完成后截图)
    Planner：这是对话记录，仅供审阅参考，不做自动验证
    Coder：xxxxx    ← xxxxx 表示任意值占位
-->

## 重点截图
<!-- 想额外看到的页面节点，自然语言描述（可选，可省略此节） -->

## 清理
<!-- 测试结束后需要清理的内容，如：删除创建的 Agent、删除 session 等 -->
