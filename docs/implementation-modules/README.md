# CreatorFlow Implementation Modules

## Purpose

本目录用于把 [creatorflow_implementation_plan.md](../../creatorflow_implementation_plan.md) 拆成可以单独推进的实施模块。每个模块文档都对应明确的代码落点、接口契约、实施步骤、风险点和验收标准，后续开发时可以按模块逐个执行，而不是反复回看总方案。

## Global Decisions

- 项目形态固定为纯前端 SPA，优先使用原生 ES Modules，不引入额外框架和打包链路。
- ComfyUI 通过可配置 `baseUrl` 直连，默认地址仍为 `http://127.0.0.1:8188`。
- 工作流提交模板以 `ltx2.3数字人工作流-api.json` 为唯一执行源，前端只做参数替换，不重写流程逻辑。
- 素材采用“选择即上传”策略：用户选中图片或音频后立即上传到 ComfyUI input 目录，再把返回文件名写入本地状态。
- 数字人模块对外暴露的时长范围固定为 `1-10s`，默认 `6s`。虽然底层工作流支持更长时长，但 MVP UI 不开放超过 `10s` 的输入。
- 本地持久化只保存任务元数据、上传后的服务端文件名、运行状态和输出结果，不在 v1 持久化 Blob。

## Module Order

| ID | Module | Goal | Depends On |
|---|---|---|---|
| M01 | [Platform Shell](./01-platform-shell.md) | 搭平台骨架、路由和应用入口 | - |
| M02 | [ComfyUI Connector](./02-comfyui-connector.md) | 封装 REST、WebSocket、上传和连接状态 | M01 |
| M03 | [Workflow Adapter And Task Schema](./03-workflow-adapter-and-task-schema.md) | 定义任务数据结构、工作流参数映射和结果解析 | M02 |
| M04 | [Task List And Batch Ops](./04-task-list-and-batch-ops.md) | 实现任务列表、批量导入、排序和复制删除 | M01, M03 |
| M05 | [Task Editor And Asset Upload](./05-task-editor-and-asset-upload.md) | 实现参数编辑、素材上传和即时校验 | M02, M03 |
| M06 | [Queue Execution And Monitor](./06-queue-execution-and-monitor.md) | 打通逐任务执行、进度监听和监控界面 | M02, M03, M04, M05 |
| M07 | [Persistence And Settings](./07-persistence-and-settings.md) | 持久化任务、设置项和刷新恢复 | M01, M03, M05 |
| M08 | [Integration QA And Release](./08-integration-qa-and-release.md) | 联调、验收、缺陷收口和交付准备 | M01-M07 |

## Shared Constraints

- 只能围绕首期“数字人批量生成”模块设计，不提前扩展图片、音频、视频编辑等其他业务模块。
- 上传逻辑、任务状态流转、结果解析只能通过统一核心层封装访问，UI 层不得直接拼 REST 请求。
- 所有任务状态必须可序列化，避免把 DOM、File、Audio 元素等不可持久化对象直接塞进状态树。
- 批量任务排序使用浏览器原生能力实现，避免为了拖拽引入新依赖。
- 每个模块的实施都要留下可验证的里程碑，避免一次性写完整体代码后再回头补结构。

## Suggested Deliverables

- 开发期主目录：`creatorflow/`
- 文档主目录：`docs/implementation-modules/`
- 如需补充编码规范或架构图，优先新建到 `docs/` 下，不污染根目录

## Exit Criteria

模块开发全部完成后，系统应满足以下条件：

- 用户可以在页面中上传图片、音频、输入提示词并选择 `1-10s` 时长。
- 前端可以根据 `ltx2.3数字人工作流-api.json` 动态替换参数并提交任务。
- 支持多任务顺序执行，实时显示节点和进度。
- 页面刷新后能恢复任务列表和已上传素材引用。
- 完成任务可以在线预览并下载视频。
