# M02 ComfyUI Connector

## Goal

把 ComfyUI 的 REST 和 WebSocket 能力封装成可复用的核心服务，统一承担连接管理、健康检查、素材上传、工作流提交、进度监听和结果查询。完成后，UI 层不再直接感知 HTTP 细节。

## Scope

- REST 请求封装
- WebSocket 生命周期管理
- 连接状态机
- 素材上传
- Prompt 提交与历史查询
- 取消执行能力封装

## Target Files

- `creatorflow/core/comfyui-client.js`
- `creatorflow/core/file-uploader.js`

## External Endpoints

实现时按“可替换端点”设计，不把端点字符串散落在 UI 层。

| Capability | Preferred Endpoint | Notes |
|---|---|---|
| 健康检查 | `/system_stats` 或 `/queue` | 选本地实例确认可用的一个 |
| 提交工作流 | `/prompt` | `POST` |
| 查询历史 | `/history/{promptId}` | `GET` |
| 查询队列 | `/queue` | `GET` |
| 中断当前执行 | `/interrupt` | 需先验证本地实例行为 |
| 上传素材 | `input upload endpoint` | 图片和音频统一走封装层，不让 UI 感知差异 |
| 进度订阅 | `/ws?clientId=xxx` | `WebSocket` |

## Connection State Machine

建议状态固定为：

- `disconnected`
- `connecting`
- `connected`
- `reconnecting`
- `error`

状态变化必须通过统一事件发布：

- `comfy:connection-changed`
- `comfy:socket-open`
- `comfy:socket-close`
- `comfy:socket-error`

## Public API

```js
class ComfyUIClient {
  constructor({ baseUrl, eventBus })
  async connect()
  disconnect()
  async testConnection()
  async submitPrompt(workflow)
  async getHistory(promptId)
  async getQueue()
  async cancelCurrent()
  async uploadAsset(file, options)
  onMessage(type, handler)
  setBaseUrl(nextUrl)
  getViewUrl({ filename, subfolder, type })
}
```

### uploadAsset Options

```js
{
  kind: 'image' | 'audio',
  filenameHint?: string,
  overwrite?: boolean
}
```

实现要求：

- 上传接口对上层隐藏“图片端点”和“音频端点”的具体差异。
- 返回统一结果结构：

```js
{
  name,
  subfolder,
  type,
  originalName,
  kind
}
```

## WebSocket Handling

要支持的消息类型至少包括：

- `status`
- `execution_start`
- `executing`
- `progress`
- `executed`
- `execution_complete`
- `execution_error`
- `execution_cached`

处理原则：

- Socket 层只解析消息和分发事件，不直接修改任务状态。
- 与任务关联的逻辑留给队列模块处理。
- 断线重连要有指数退避和上限，不允许无休止高频重连。

## Implementation Steps

### Step 1: Build HTTP Wrapper

- 统一实现 `request(path, options)`。
- 集中处理超时、错误文本、JSON 解析异常。

### Step 2: Build Connection Probe

- `testConnection()` 只做轻量请求。
- App 启动后先探活，再决定是否打开 WebSocket。

### Step 3: Build WebSocket Manager

- 生成 `clientId`。
- 维护当前 socket 引用、重连计数、最后一次连接时间。

### Step 4: Build Upload Service

- `file-uploader.js` 负责 `FormData` 构建和上传重试。
- 上层只拿统一返回结果，不关心上传细节。

### Step 5: Build History And View Helpers

- 把 `/history` 解析和 `/view` URL 拼接收口到客户端类内。

## Risks

- 音频上传端点在不同 ComfyUI 环境中可能存在行为差异，必须先在当前本地实例上验证。
- 如果 WebSocket 断线后没有补偿查询，任务状态会与真实执行状态漂移。
- 如果 `cancelCurrent()` 只做前端状态更新，不实际调用中断接口，会制造“假停止”。

## Acceptance

- 可以通过一组统一 API 完成探活、上传、提交、查历史、取结果地址。
- WebSocket 能稳定接收进度和节点消息。
- 断网或 ComfyUI 重启后，连接状态能正确变化并尝试恢复。
- UI 层无需直接使用 `fetch('/prompt')` 这类裸请求。
