# T01 本地编排服务基建

## 任务目标

建立一个可运行的本地编排服务，作为长音频分段生成任务的后台执行器，为后续所有任务提供统一入口。

## 任务范围

- 新增本地编排服务工程目录
- 建立基础 REST API
- 建立任务持久化能力
- 建立配置管理
- 接入 `ffmpeg` 可用性检查
- 接入 ComfyUI 连接性检查

## 不在范围内

- 不实现音频切分算法
- 不实现分段执行主流程
- 不改前端执行入口

## 当前差距

当前项目只有纯前端 SPA 和直接面向 ComfyUI 的调用层，没有真正后台，也没有任务生命周期持久化能力。

## 目标产出

- 一个可启动的本地服务
- 一个最小任务表结构
- 健康检查与依赖检查接口
- 基础日志与错误处理框架

## 建议目录

- `services/orchestrator/`
- `services/orchestrator/app/`
- `services/orchestrator/app/api/`
- `services/orchestrator/app/core/`
- `services/orchestrator/app/models/`
- `services/orchestrator/data/`

## 接口建议

### `GET /api/health`

返回：

- 服务状态
- SQLite 状态
- ComfyUI 连通性
- `ffmpeg` / `ffprobe` 可用性

### `POST /api/jobs`

先支持最小任务创建，哪怕只写入数据库，不立即执行。

### `GET /api/jobs`

返回任务列表摘要。

## 详细步骤

### Step 1 建立服务骨架

- 选定 Python + FastAPI
- 建立启动入口
- 建立配置加载机制

### Step 2 建立依赖探测

- 探测 `ffmpeg`
- 探测 `ffprobe`
- 探测 ComfyUI 地址

### Step 3 建立存储

- 初始化 SQLite
- 建立 `jobs` 表
- 建立迁移机制或初始化脚本

### Step 4 建立基础 API

- 健康检查
- 创建任务
- 查询任务列表
- 查询任务详情

### Step 5 建立日志

- 任务级日志
- 系统级日志

## 风险点

1. 环境依赖缺失导致服务虽然启动，但任务不可执行。
2. 若不尽早统一配置项，后续会出现前后端路径不一致。

## 验收标准

- 服务可启动
- 健康检查接口可返回依赖状态
- 可创建一个空任务并写入 SQLite
- 重启服务后任务记录仍存在
