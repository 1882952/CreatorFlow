# M04 Task List And Batch Ops

## Goal

实现数字人模块左侧任务列表区域，让用户可以快速创建、浏览、勾选、排序、复制和删除任务，并支持批量导入图片生成待补全任务。

## Scope

- 任务列表渲染
- 当前选中项管理
- 勾选/全选/取消全选
- 拖拽排序
- 批量导入图片
- 复制任务
- 删除任务

## Target Files

- `creatorflow/modules/digital-human/task-list.js`
- `creatorflow/modules/digital-human/digital-human.css`
- `creatorflow/modules/digital-human/digital-human.js`

## UI Requirements

每个列表项包含：

- 勾选框
- 缩略图
- 任务名称
- 状态标签
- 快捷操作区

顶部工具栏包含：

- `+ 新增任务`
- `全选 / 取消全选`
- `删除已选`

底部包含：

- 总任务数
- 已选任务数

## Interaction Design

### Create

- 点击新增任务时，立刻插入一个默认任务。
- 新任务自动选中并在右侧打开编辑器。

### Select

- 单击列表项切换右侧详情。
- 勾选框只影响是否参与执行，不影响右侧是否显示。

### Reorder

- 使用原生 HTML5 Drag and Drop。
- 落点只更新任务顺序数组，不在拖拽过程中重建整棵列表树。

### Duplicate

- 复制时保留：
  - 提示词
  - seed
  - duration
  - fps
  - maxResolution
- 复制时清空：
  - image
  - audio
  - promptId
  - output
  - error
  - progress

### Bulk Import Images

- 拖入多张图片后，为每张图片创建一个任务。
- 这些任务默认状态为 `draft`，等待补充音频和提示词。
- 导入完成后自动选中第一条新任务。

## State Ownership

建议数据归属如下：

- `digital-human.js` 持有任务数组和当前选中 ID
- `task-list.js` 只负责渲染和交互事件抛出

推荐事件：

- `task:create`
- `task:select`
- `task:toggle-selected`
- `task:select-all`
- `task:delete`
- `task:duplicate`
- `task:reorder`
- `task:bulk-image-import`

## Implementation Steps

### Step 1: Render Empty State

- 无任务时显示空状态卡片，提示用户创建任务或拖入图片。

### Step 2: Render Item States

- 用统一状态标签函数渲染 `draft`、`ready`、`running`、`completed`、`failed`。

### Step 3: Add Toolbar Actions

- 实现新增、全选、批量删除。

### Step 4: Add Drag Sort

- 使用任务 ID 重新排序。
- 排序完成后触发持久化。

### Step 5: Add Bulk Import

- 任务列表区域本身也支持拖入图片。
- 批量导入与右侧编辑器上传区域逻辑分开，不共用状态。

## Risks

- 如果“选中态”和“执行勾选态”混成一个字段，后续会频繁互相覆盖。
- 如果拖拽排序直接重建任务对象，可能导致右侧编辑器引用丢失。
- 如果复制任务时不清空执行字段，旧任务结果会污染新任务。

## Acceptance

- 用户可以新增、选中、勾选、复制、删除任务。
- 支持原生拖拽调整执行顺序。
- 支持拖入多张图片快速生成任务。
- 列表渲染对 50-100 条任务仍然保持流畅。
