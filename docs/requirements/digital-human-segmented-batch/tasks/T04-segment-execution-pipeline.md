# T04 分段执行主流程与 ComfyUI 编排

## 任务目标

把音频分段结果真正串起来，形成“逐段上传、逐段生成、逐段回收结果”的后台执行主链路。

## 任务范围

- 读取分段计划
- 上传分段音频和参考图
- 构建每段工作流
- 提交 ComfyUI prompt
- 等待执行完成
- 解析分段结果
- 更新任务和分段状态

## 不在范围内

- 不做尾帧抽取逻辑实现
- 不做最终拼接

## 当前差距

当前只有前端 `TaskQueue` 的单任务单 prompt 模型，没有后台 Job 级编排。

## 详细步骤

### Step 1 任务预处理

- 读取 Job
- 加载 Segment 列表
- 检查 ComfyUI 是否可用

### Step 2 单段执行模板

为每段固定执行：

1. 准备输入素材
2. 上传到 ComfyUI
3. 构建工作流参数
4. 提交 prompt
5. 等待完成
6. 拉取 history
7. 解析输出视频路径

### Step 3 状态持久化

- 每个关键动作写入 SQLite
- 每段更新独立状态
- Job 聚合当前进度

### Step 4 中断与取消

- 支持取消当前任务
- 支持在段与段之间停止
- 需要时调用 ComfyUI interrupt

## 工作流参数建议

- `image`
- `audio`
- `prompt`
- `seed`
- `duration`
- `fps`
- `max_resolution`
- `filename_prefix`

## 关键风险

1. 如果 prompt_id 与 segment 归属不清，进度会串乱。
2. 如果状态只在内存里更新，服务重启后无法恢复。

## 验收标准

- 单个 Job 可以顺序执行多个 Segment
- 每个 Segment 都有独立状态和输出
- 中途失败时可准确停在失败段
- 任务日志中可追踪 `prompt_id`
