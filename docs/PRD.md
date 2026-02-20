# OpenClaw x Claude Code Bridge — PRD

## 1. 背景与目标

我们需要一个合规、可维护的方式，让 OpenClaw 在遇到复杂编程/运维任务时，自动委托给 Claude Code CLI 执行，而不是依赖逆向 API。

本项目目标：
- 把 Claude Code CLI 封装成 OpenClaw 可调用的「文件驱动 AI Core」
- 通过 MCP 暴露/转接工具能力，让 Claude Code 在受控工具集内工作
- 保持自托管、低耦合、可观测、可恢复

## 2. 约束与合规边界

- 不逆向任何官方 API
- 不绕过商业授权，必须使用合法可用的 Claude Code CLI 订阅/凭据
- 默认仅用于内部自用与自动化
- 所有执行都可审计（输入、命令、输出、错误、耗时）

## 3. 目标用户

- 单人或小团队的 AI 运维者
- 使用 OpenClaw 作为统一入口（Telegram/Web），需要强代码执行能力
- 需要在 VM/裸机上稳定运行并可自动恢复

## 4. 问题定义

当前痛点：
- OpenClaw 在复杂代码生成/重构任务上不稳定或能力不足
- 多模型切换与网络环境波动导致任务中断
- 缺少统一“高难任务下沉到强编码引擎”的机制

要解决的问题：
- 如何把「OpenClaw 的任务意图」转换为「Claude Code 可执行输入」
- 如何让 Claude Code 安全使用工具（文件、shell、网页、MCP）
- 如何把结果可靠回传给 OpenClaw（含失败可恢复）

## 5. 产品范围（V1）

### In Scope

- OpenClaw Skill: `claude-bridge`
- Bridge Core（本地服务/CLI）：
  - 接收任务（JSON）
  - 构造工作目录与上下文文件
  - 调用 Claude Code CLI
  - 生成结构化结果（summary / artifacts / exit_code）
- MCP Adapter：
  - 将 OpenClaw Toolkit 封装为 MCP server
  - Bridge 启动 Claude Code 时注入 MCP 配置
- 结果回传：
  - 标准输出摘要
  - 产物路径（patch、脚本、日志）
  - 错误分类（网络、权限、模型、超时、工具）
- 基础保活：
  - LaunchAgent/systemd 模板
  - 心跳与重试策略

### Out of Scope（V1）

- 多租户隔离
- 远程分布式任务队列
- Web 控制台（先用 CLI + 日志）
- 计费系统

## 6. 核心方案

### 6.1 架构组件

- `openclaw-skill`：OpenClaw 入口技能，负责触发与参数规范化
- `bridge-runner`：任务编排器（文件驱动）
- `mcp-openclaw-toolkit`：将现有工具以 MCP 协议暴露
- `claude-exec`：Claude Code CLI 调用层（超时、重试、资源限制）
- `result-publisher`：结果标准化与回传

### 6.2 文件驱动协议（Draft）

任务目录示例：

```
.runs/<run_id>/
  request.json
  context/
  logs/
  artifacts/
  result.json
```

`request.json` 核心字段：
- `task_id`
- `intent`（coding/refactor/debug/ops）
- `workspace_path`
- `constraints`（timeout、network、allow_commands）
- `inputs`（用户文本、附件索引、已有文件）

`result.json` 核心字段：
- `status`（success/failed/partial）
- `summary`
- `artifacts`（文件列表）
- `next_actions`
- `error`（code/message/retryable）

### 6.3 控制流

1. OpenClaw 命中 `claude-bridge` skill
2. Skill 生成 `request.json` 并调用 `bridge-runner`
3. `bridge-runner` 启动 MCP Adapter
4. `bridge-runner` 调用 Claude Code CLI（携带任务上下文）
5. Claude Code 读写工作目录并通过 MCP 调用工具
6. `bridge-runner` 收敛结果，写入 `result.json`
7. OpenClaw 读取结果并回复用户

## 7. 功能需求

### FR-1 任务提交
- 支持文本任务 + 附件索引（先不做二进制搬运）
- 支持显式 `workspace_path`

### FR-2 Claude 执行
- 支持模型参数透传（如 profile/model）
- 支持命令超时与中断
- 支持失败重试（仅 retryable 错误）

### FR-3 工具接入
- 至少支持：文件读写、shell、git、web-fetch（按策略开关）
- 工具调用日志可追溯

### FR-4 结果回传
- 统一 JSON 输出，OpenClaw 可直接渲染
- 对失败给出可执行的修复建议

### FR-5 可运维性
- 提供 `healthcheck` 命令
- 提供 `doctor` 命令定位环境问题（token、网络、权限、路径）

## 8. 非功能需求

- 可靠性：单任务成功率 > 95%（排除外部 API 故障）
- 可观测性：每个 run 有完整日志与耗时
- 安全性：默认最小权限，命令 allowlist/denylist
- 可移植性：macOS first，Linux second

## 9. 风险与对策

- CLI/模型行为变化：
  - 对策：版本锁定 + 兼容层 + 集成测试
- 网络代理不稳定：
  - 对策：统一代理注入脚本 + preflight 检查
- 工具权限过大：
  - 对策：MCP 工具分级，默认只读，按任务提升
- 长任务中断：
  - 对策：心跳 + checkpoint + 可恢复 run

## 10. 里程碑

### M1（Week 1）
- 初始化仓库与协议定义
- `bridge-runner` MVP（本地 JSON -> Claude -> result.json）

### M2（Week 2）
- MCP Adapter MVP（最小工具集）
- OpenClaw skill 打通端到端

### M3（Week 3）
- 保活与健康检查
- 错误分类和自动重试

### M4（Week 4）
- 文档、示例、回归测试
- 小规模生产验证

## 11. 验收标准

- 能在 OpenClaw 中通过一个 skill 触发 Claude Code 完成真实代码任务
- `result.json` 始终可解析，失败时包含错误码和建议动作
- 在网络正常条件下，连续 30 次任务成功率 >= 95%
- Bridge 服务重启后可继续处理新任务

## 12. 仓库初始结构（建议）

```
codebridge/
  PRD.md
  README.md
  specs/
    request.schema.json
    result.schema.json
  bridge/
    runner.sh
    healthcheck.sh
  mcp/
    server.ts
  skill/
    claude-bridge/SKILL.md
  tests/
```

## 13. 下一步

- 根据本 PRD 输出技术设计（TDD）
- 定义 `request/result` JSON Schema
- 实现最小可跑通版本并接入你的 VM OpenClaw
