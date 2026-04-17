# M08 Integration QA And Release

## Goal

把前面模块收口成可交付的 MVP，完成联调、缺陷修复、手工验收、发布准备和开发顺序控制，避免只完成“代码存在”而没有形成“可运行产品”。

## Scope

- 联调顺序
- 手工测试矩阵
- 缺陷分类
- 发布前检查
- 交付定义

## Recommended Delivery Order

1. M01 Platform Shell
2. M02 ComfyUI Connector
3. M03 Workflow Adapter And Task Schema
4. M04 Task List And Batch Ops
5. M05 Task Editor And Asset Upload
6. M07 Persistence And Settings
7. M06 Queue Execution And Monitor
8. 全链路联调与收口

说明：

- M07 放在 M06 前面完成，可以让执行链路一开始就建立在可恢复的任务模型上。
- M06 最后接入，避免在 UI 和 schema 还不稳定时反复改队列逻辑。

## Integration Checklist

### Connection

- 默认地址可连接到本地 ComfyUI
- 地址修改后能重新探活
- Socket 断开后状态栏能正确变化

### Upload

- 上传图片成功并显示缩略图
- 上传音频成功并显示时长
- 上传失败可重新上传

### Workflow Mapping

- 图片、音频、提示词、时长、fps、分辨率都成功写入 prompt
- 时长输入超过 `10s` 时被截断
- 输出文件名前缀唯一

### Queue

- 2 个任务按顺序执行
- 第 1 个任务失败不阻塞第 2 个
- 暂停在当前任务完成后生效
- 停止会请求中断 ComfyUI

### Result

- 完成任务可以预览视频
- 可以下载视频
- 刷新后仍能看到已完成结果

### Recovery

- 刷新后任务列表恢复
- 设置项恢复
- 失效素材会被明确标记，而不是静默失败

## Manual Test Matrix

| Case | Input | Expected |
|---|---|---|
| T01 | 单任务完整输入 | 成功生成结果 |
| T02 | 仅图片无音频 | 任务不能进入 ready |
| T03 | 时长输入 12 | UI 自动修正为 10 |
| T04 | 两任务连续执行 | 第二个任务在第一个完成后启动 |
| T05 | 第一个任务素材失效 | 第一个失败，第二个继续 |
| T06 | 执行中刷新页面 | 页面恢复任务，运行态不假保留 |
| T07 | 修改 ComfyUI 地址 | 连接状态重新计算 |
| T08 | 停止当前任务 | 本地状态和 ComfyUI 执行同步停止 |

## Defect Priority

- `P0` 无法连接、无法提交、结果无法获取
- `P1` 任务状态错乱、进度串任务、停止无效
- `P2` 刷新恢复异常、预览不稳定、批量操作问题
- `P3` 样式、文案、动效问题

## Definition Of Done

以下条件全部满足才算首期可交付：

- 用户可以在一个页面内完成任务创建、素材上传、参数编辑和执行。
- 前端能够基于 API JSON 模板生成执行 prompt。
- 数字人任务时长在产品层面被限制为 `10s` 以内。
- 多任务队列、监控、结果预览和下载均可运行。
- 刷新恢复和设置页可用。
- 至少完成一轮从创建任务到拿到结果视频的端到端验证。

## Release Notes Template

交付时建议输出一份简短变更说明：

- 新增能力
- 已知限制
- 环境前提
- 待下一阶段处理的问题

## Known Follow-Up Items

- 音频上传端点兼容性如有差异，需记录为环境依赖说明。
- 如后续要支持更长时长，应先评估性能和稳定性，再放开 `10s` 限制。
- 若未来加入更多业务模块，需要把数字人模块中可复用部分上提到 `shared/`。
