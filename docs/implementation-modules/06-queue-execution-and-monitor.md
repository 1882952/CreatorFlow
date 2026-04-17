# M06 Queue Execution And Monitor

## Goal

实现任务执行编排和监控界面，把“已上传素材 + 已填写参数”的任务按顺序提交给 ComfyUI，并在运行过程中显示阶段、节点、进度和日志。

## Scope

- 执行前校验
- 逐任务执行
- 暂停、停止、重试失败
- prompt_id 与任务关联
- WebSocket 进度归属
- 当前任务监控
- 全局队列监控

## Target Files

- `creatorflow/core/task-queue.js`
- `creatorflow/modules/digital-human/execution-monitor.js`
- `creatorflow/modules/digital-human/digital-human.js`

## Queue State Machine

### Queue Level

- `idle`
- `running`
- `pause_requested`
- `stopping`
- `completed`

### Task Level

- `draft`
- `ready`
- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

## Execution Pipeline

对单个任务固定执行以下步骤：

1. 读取最新任务快照
2. 校验素材和参数
3. 确认 `image.uploadedName`、`audio.uploadedName` 存在
4. 通过 `buildWorkflow(task)` 生成 prompt
5. 调用 `submitPrompt(workflow)`
6. 记录 `promptId`
7. 监听 `execution_start / executing / progress / executed / execution_complete`
8. 完成后查询 `history`
9. 解析输出并更新任务结果

注意：

- 因为采用“选择即上传”策略，执行阶段不再重新上传素材。
- 如果素材引用丢失，应把任务标记为 `asset_missing` 或 `failed`，而不是悄悄重跑上传逻辑。

## Event Model

推荐由 `task-queue.js` 对外发出：

- `queue:started`
- `queue:paused`
- `queue:stopped`
- `queue:completed`
- `queue:task-started`
- `queue:task-progress`
- `queue:task-completed`
- `queue:task-failed`
- `queue:log`

## Monitor Panel Layout

右侧监控面板建议分三块：

### Current Task

- 任务名
- 缩略图
- 当前阶段
- 当前节点
- 进度条
- 剩余时间估算

### Queue Overview

- 全部任务简表
- 当前执行索引
- 已完成数 / 总数

### Live Log

- WebSocket 消息简化版
- 关键动作日志
- 最多保留最近 `200` 条，避免无限增长

## Pause And Stop Rules

### Pause

- 只影响“下一个任务是否继续”
- 当前正在执行的任务允许自然完成

### Stop

- 进入 `stopping`
- 调用 `cancelCurrent()`
- 当前任务标记为 `cancelled` 或 `failed`
- 队列回到 `idle`

### Retry Failed

- 扫描全部 `failed` 任务
- 清空 `error`、`progress`、`promptId`
- 状态回到 `ready`

## Implementation Steps

### Step 1: Build Queue Core

- 实现队列遍历和状态切换。
- 不把 UI 渲染代码写进 `task-queue.js`。

### Step 2: Correlate prompt_id

- 用 `promptId -> taskId` 映射表归属 WebSocket 消息。

### Step 3: Build Progress Reducer

- 把 `progress.value / progress.max` 转成统一百分比和显示文案。

### Step 4: Build Monitor UI

- 数字人模块在 `running` 时切换到监控视图。
- 支持点击已完成任务快速查看结果。

### Step 5: Add Pause Stop Retry

- 确保三种控制动作不会互相覆盖状态。

## Risks

- 如果不建立 `promptId -> taskId` 映射，多任务时进度会串到错误任务上。
- 如果停止逻辑只改本地状态，ComfyUI 仍会继续跑，最终会回写意外结果。
- 如果监控面板直接消费原始 WebSocket 全量消息，UI 会被底层格式绑死。

## Acceptance

- 可以一键顺序执行多个任务。
- 执行中能看到当前节点和进度。
- 支持暂停、停止、重试失败。
- 某个任务失败不会阻塞后续任务。
- 监控面板能清楚反映当前任务和全局队列状态。
