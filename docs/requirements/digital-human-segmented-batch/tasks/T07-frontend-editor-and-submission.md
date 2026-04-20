# T07 前端任务编辑与提交链路改造

## 任务目标

让 CreatorFlow 前端可以配置长音频分段生成任务，并把任务提交给本地编排服务，而不是直接由浏览器自己编排执行。

## 任务范围

- 设置项新增编排服务地址和输出目录
- 任务编辑器新增分段配置
- 提交流程改为调用编排服务 API
- 保留旧直连模式作为临时回滚手段

## 受影响的现有文件

- `creatorflow/core/app.js`
- `creatorflow/modules/settings/settings-panel.js`
- `creatorflow/modules/digital-human/task-editor.js`
- `creatorflow/modules/digital-human/digital-human.js`

## 不在范围内

- 不负责监控面板细节
- 不负责后台分段执行逻辑

## 新增前端配置

- `orchestratorBaseUrl`
- `defaultOutputDir`
- `cleanupAfterSeconds`
- `debugKeepIntermediates`

## 编辑器新增字段

- 分段模式
- 每段最大时长
- 输出目录
- 清理策略

## 提交流程改造

### 旧流程

- 前端本地任务状态
- 直接构建工作流
- 直接提交 ComfyUI

### 新流程

- 前端收集表单
- 调用编排服务 `POST /api/jobs`
- 得到 `jobId`
- 调用 `start`
- 切到监控态

## 实施步骤

### Step 1 新增设置项

- 新增 UI
- 新增持久化

### Step 2 升级任务编辑器

- 增加分段相关配置
- 调整校验文案

### Step 3 接入任务创建 API

- 支持带文件的创建请求
- 更新本地任务与后台任务的映射关系

### Step 4 保留灰度切换

- 在设置中保留 `direct` 与 `orchestrated` 模式切换，便于回滚

## 风险点

1. 如果前端仍把自己当成执行真相源，会和后台状态冲突。
2. 文件上传链路从“传 ComfyUI”切为“传编排服务”后，需要重新梳理预览与元数据来源。

## 验收标准

- 前端可以配置并提交新任务
- 新任务能拿到后台 `jobId`
- 设置项刷新后不丢失
- 可通过特性开关回退到旧模式
