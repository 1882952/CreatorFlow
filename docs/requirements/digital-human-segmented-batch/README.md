# 数字人分段批量生成需求包

## 说明

本目录用于承载“数字人长音频分段生成、尾帧衔接、自动拼接、落盘与清理”功能的完整需求与实施文档。文档基于当前项目现状编写，默认目标形态为：

- 前端继续保留 CreatorFlow 作为操作台
- 新增本地编排服务作为真正的后台执行器
- ComfyUI 继续负责单段生成
- 本地 `ffmpeg` 负责分段、抽帧、拼接和清理

## 阅读顺序

1. [PRD.md](./PRD.md)
2. [technical-design.md](./technical-design.md)
3. [feasibility.md](./feasibility.md)
4. [task-breakdown.md](./task-breakdown.md)
5. `tasks/` 目录下的子任务文档

## 文档清单

- [PRD.md](./PRD.md)
  说明产品目标、范围、约束、功能需求、边界条件和验收标准
- [technical-design.md](./technical-design.md)
  说明目标架构、数据模型、执行流程、接口契约和运行策略
- [feasibility.md](./feasibility.md)
  说明关键技术点、可行性结论、风险和备选方案
- [task-breakdown.md](./task-breakdown.md)
  说明任务拆解、依赖关系、优先级和实施顺序

## 子任务文档

- [T01 本地编排服务基建](./tasks/T01-local-orchestrator-foundation.md)
- [T02 任务模型与前后端契约升级](./tasks/T02-job-model-and-contract.md)
- [T03 音频分段与停顿点切分引擎](./tasks/T03-audio-segmentation-engine.md)
- [T04 分段执行主流程与 ComfyUI 编排](./tasks/T04-segment-execution-pipeline.md)
- [T05 尾帧连续性与参考图传递](./tasks/T05-tail-frame-continuity.md)
- [T06 拼接落盘与中间文件清理](./tasks/T06-concat-persistence-cleanup.md)
- [T07 前端任务编辑与提交链路改造](./tasks/T07-frontend-editor-and-submission.md)
- [T08 监控、恢复、重试与结果展示](./tasks/T08-monitor-retry-recovery.md)
- [T09 联调、验收与发布收口](./tasks/T09-integration-qa-release.md)

## 使用建议

- 如果要先做最小闭环，优先完成 `T01-T06`
- 如果要保证可操作性和可回归性，再完成 `T07-T09`
- 任何编码任务启动前，建议直接引用对应的子任务文档作为执行输入
