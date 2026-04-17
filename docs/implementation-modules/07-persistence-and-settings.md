# M07 Persistence And Settings

## Goal

让任务状态、已上传素材引用、页面设置和连接配置在刷新后可恢复，同时提供独立设置页调整 ComfyUI 地址和平台偏好。

## Scope

- localStorage 封装
- 任务持久化
- 页面设置持久化
- 刷新恢复
- 设置面板
- 素材缺失检测

## Target Files

- `creatorflow/core/storage.js`
- `creatorflow/core/app.js`
- `creatorflow/modules/settings/index.js`
- `creatorflow/modules/settings/settings-panel.js`

## Storage Keys

建议集中管理键名：

```js
creatorflow.settings
creatorflow.digitalHuman.tasks
creatorflow.digitalHuman.selection
creatorflow.router.lastRoute
```

## Persisted Settings

- `comfyBaseUrl`
- `sidebarCollapsed`
- `lastRoute`
- 可选：`monitorLogExpanded`

## Persisted Task Fields

只保存可序列化且对恢复有价值的数据：

- `id`
- `name`
- `selected`
- `status`
- `image.originalName`
- `image.uploadedName`
- `image.previewUrl`
- `audio.originalName`
- `audio.uploadedName`
- `audio.previewUrl`
- `audio.duration`
- `prompt`
- `seed`
- `duration`
- `fps`
- `maxResolution`
- `output`
- `createdAt`
- `startedAt`
- `completedAt`

不要保存：

- `File`
- DOM 引用
- WebSocket 句柄
- 运行时定时器

## Recovery Rules

### On App Start

1. 加载设置
2. 初始化 `baseUrl`
3. 恢复路由
4. 恢复任务列表
5. 对每个任务执行 `normalizeTask()`

### Asset Validation

采用“选择即上传”后，任务恢复时需要确认服务端引用是否仍然有效。MVP 可采用轻量策略：

- 若存在 `uploadedName`，默认先恢复展示
- 当用户再次执行该任务时，若服务端报引用不存在，则标记 `asset_missing`
- UI 提示用户重新上传对应素材

这样可以避免启动阶段对每个素材做额外探测请求。

## Settings Panel

设置页至少包含：

- ComfyUI 服务地址输入框
- 测试连接按钮
- 侧边栏折叠偏好
- 当前连接状态展示

地址变更规则：

- 保存设置后立即调用 `setBaseUrl()`
- 重新探活并更新状态栏

## Implementation Steps

### Step 1: Build Storage Wrapper

- 为 `get/set/remove` 加统一异常处理。
- JSON 解析失败时自动回退默认值。

### Step 2: Add Save Triggers

- 任务数组变更后节流保存。
- 设置变更后立即保存。

### Step 3: Add Restore Logic

- 恢复任务和当前选中项。
- 执行中状态在刷新后统一回退为可恢复状态，避免伪“运行中”。

### Step 4: Build Settings Module

- 注册 `#/settings`
- 提供独立设置页 UI

## Risks

- 如果执行中状态原样保存，刷新后用户会看到“假运行中”任务。
- 如果每次输入都立刻写 localStorage，批量编辑时会造成高频序列化。
- 如果服务端素材失效没有单独状态，用户只会在执行失败时看到模糊错误。

## Acceptance

- 刷新页面后任务列表、勾选态、输出结果和设置项可恢复。
- 设置页可修改 ComfyUI 地址并触发重新连接。
- 已上传素材引用被保留下来。
- 引用失效时能给出明确的重新上传提示。
