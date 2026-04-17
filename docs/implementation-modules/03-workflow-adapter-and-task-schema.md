# M03 Workflow Adapter And Task Schema

## Goal

把数字人任务定义成稳定的数据模型，并基于 `ltx2.3数字人工作流-api.json` 建立参数映射、校验规则和结果解析规则。这个模块是 UI、队列和持久化的共同基础。

## Scope

- 任务数据结构
- 任务状态枚举
- 参数校验与标准化
- 工作流模板加载
- 节点参数替换
- 历史结果解析

## Target Files

- `creatorflow/modules/digital-human/task-schema.js`
- `creatorflow/modules/digital-human/workflow-template.js`
- `creatorflow/assets/workflows/ltx23-digital-human-api.json`

## Design Decisions

- 根目录现有 `ltx2.3数字人工作流-api.json` 保持不动，运行时拷贝一份到 `creatorflow/assets/workflows/` 作为前端读取源。
- 工作流模板只允许被 `buildWorkflow(task)` 返回的新对象修改，不允许原地改模板。
- 产品级时长约束固定为 `1-10s`，在 schema 层执行 clamp 和校验，而不是放任 UI 自由输入。

## Task Schema

```js
{
  id,
  name,
  selected,
  status,
  validation,
  image: {
    originalName,
    uploadedName,
    previewUrl,
    size,
    width,
    height,
    uploadState
  },
  audio: {
    originalName,
    uploadedName,
    previewUrl,
    size,
    duration,
    uploadState
  },
  prompt,
  seed,
  duration,
  fps,
  maxResolution,
  promptId,
  progress,
  progressLabel,
  currentNode,
  error,
  output: {
    filename,
    subfolder,
    type,
    videoUrl
  },
  createdAt,
  startedAt,
  completedAt
}
```

## Status Enum

- `draft`
- `ready`
- `uploading`
- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `asset_missing`

说明：

- `draft` 表示字段还没填完。
- `ready` 表示可执行。
- `asset_missing` 表示本地恢复后发现服务端素材引用失效。

## Validation Rules

### Required

- 参考图已上传成功
- 音频已上传成功
- 提示词非空

### Optional With Defaults

- `seed = 42`
- `duration = 6`
- `fps = 30`
- `maxResolution = 1280`

### Range Rules

- `duration: 1-10`
- `fps: 1-60`
- `maxResolution: 768 | 1024 | 1280`

## Workflow Mapping

| Business Field | Node ID | Input Field | Notes |
|---|---|---|---|
| image.uploadedName | `444` | `image` | LoadImage |
| audio.uploadedName | `1594` | `audio` | LoadAudio |
| prompt | `1624` | `value` | 用户提示词原值 |
| seed | `1527` | `value` | Start Seed |
| duration | `1583` | `value` | UI 上限 10 |
| fps | `1586` | `value` | PrimitiveFloat |
| maxResolution | `1606` | `value` | 最大分辨率 |
| output prefix | `1747` | `filename_prefix` | 需动态唯一化 |

## Prompt Handling

当前工作流中，正向提示链路为：

- `1624` 用户提示词
- `1753` JoinStrings
- `1621` CLIPTextEncode

前端实现要求：

- 只覆盖 `1624.inputs.value`
- 不直接改动 `1753` 和 `1621` 的结构
- 保留工作流内部固定前缀拼接逻辑

## Output Handling

`1747` 是最终输出节点。结果解析时要：

1. 读取 `history[promptId]`
2. 定位节点 `1747` 的输出
3. 从输出中提取 `filename`、`subfolder`、`type`
4. 调用 `getViewUrl()` 生成可播放地址

实现时不要把结果解析写死成单一数组索引，优先兼容字段名查找。

## filename_prefix Rule

为了避免批量任务输出冲突，`buildWorkflow(task)` 中必须覆盖：

```js
creatorflow-dh-${task.id}-${Date.now()}
```

不能继续沿用模板内的固定 `ltx23-kj-aijuxi-r`。

## Implementation Steps

### Step 1: Move Runtime Template

- 复制 API JSON 到应用资产目录。
- 保留根目录工作流文件作为原始参考。

### Step 2: Create Task Factories

- 实现 `createTask()`
- 实现 `cloneTask()`
- 实现 `normalizeTask()`
- 实现 `validateTask()`

### Step 3: Build Workflow Adapter

- 模板只读加载
- 使用 `structuredClone()` 生成执行对象
- 替换节点参数
- 注入唯一输出前缀

### Step 4: Build Result Extractor

- 从 `history` 中抽出视频结果
- 失败时返回结构化错误，而不是 `null`

## Risks

- 如果任务 schema 里保留浏览器 `File` 对象，刷新恢复会失效。
- 如果状态枚举定义过少，后续“上传失败”和“素材缺失”会被混进 `failed`，难以修复和提示。
- 如果 `filename_prefix` 不唯一，多任务运行时可能覆盖输出文件。

## Acceptance

- 能创建、复制、标准化和校验任务对象。
- 能基于同一个模板构建多份独立工作流对象。
- 前端时长输入被稳定限制在 `10s` 以内。
- 可以从历史结果中稳定抽出最终视频信息。
