# M05 Task Editor And Asset Upload

## Goal

实现数字人模块右侧编辑面板，支持图片和音频上传、提示词录入、基础参数编辑和即时校验。这个模块直接承接用户“外部调用链路补全”的核心输入动作。

## Scope

- 任务名称编辑
- 图片上传与预览
- 音频上传、元数据读取与试听
- 提示词输入
- 高级参数编辑
- 即时校验和错误提示

## Target Files

- `creatorflow/modules/digital-human/task-editor.js`
- `creatorflow/modules/digital-human/digital-human.css`
- `creatorflow/modules/digital-human/digital-human.js`

## Product Decisions

- 上传策略固定为“选择即上传”。
- 图片、音频上传成功后立刻回填 `uploadedName`。
- 时长控件 UI 限制为 `1-10s`。
- 超过 `10s` 的手工输入值进入 schema 之前直接被截断到 `10`。

## Editor Sections

### Section 1: Basic Info

- 任务名称输入框
- 当前状态提示

### Section 2: Image Upload

- 拖拽区
- 选择文件按钮
- 上传中状态
- 缩略图预览
- 文件名、尺寸、大小

### Section 3: Audio Upload

- 拖拽区
- 选择文件按钮
- 上传中状态
- 文件名、时长、格式、大小
- 原生 `<audio controls>` 试听

### Section 4: Prompt

- 多行文本框
- 字数提示
- 非空校验

### Section 5: Advanced Settings

- `seed`
- `duration`
- `fps`
- `maxResolution`

## Upload Flow

### Image

1. 用户选择图片
2. 前端读取本地预览
3. 调用 `uploadAsset(file, { kind: 'image' })`
4. 成功后回填 `image.uploadedName`
5. 更新任务状态和校验结果

### Audio

1. 用户选择音频
2. 前端解析音频时长
3. 调用 `uploadAsset(file, { kind: 'audio' })`
4. 成功后回填 `audio.uploadedName`
5. 更新任务状态和校验结果

## UI State

上传字段独立维护以下子状态：

- `idle`
- `uploading`
- `uploaded`
- `failed`

不要把整个任务状态直接拿来驱动上传区域，否则运行态和编辑态会互相污染。

## Validation Feedback

右侧编辑器至少显示三类提示：

- 必填项缺失
- 上传失败
- 参数越界

其中时长规则要明确显示为：

`推荐 1-10 秒，MVP 不允许超过 10 秒`

## Implementation Steps

### Step 1: Build Editor Skeleton

- 先实现无数据、选中任务、执行中不可编辑三种视图。

### Step 2: Add Upload Components

- 图片和音频分别实现拖拽区。
- 上传失败支持重新选择覆盖。

### Step 3: Add Prompt And Advanced Inputs

- 基础输入实时写回任务状态。
- 高级参数放折叠区，默认展开图片和音频区。

### Step 4: Add Metadata Parsing

- 图片解析宽高
- 音频解析时长

### Step 5: Add Inline Validation

- 每次字段变更后调用 `validateTask()`。
- 校验结果应以结构化对象返回，而不是纯字符串拼接。

## Risks

- 如果上传与预览的流程耦合在一起，上传失败时容易丢掉本地预览。
- 如果音频时长完全信任用户输入，而不读取实际文件，后续可能出现音频短于生成时长的异常。
- 如果执行中仍允许编辑关键字段，提交中的任务和页面显示会出现不一致。

## Acceptance

- 用户可以上传参考图、音频并即时看到上传结果。
- 音频可试听，图片可预览。
- 提示词、时长、fps、分辨率可编辑并即时校验。
- 时长输入被稳定限制到 `10s` 以内。
- 已上传素材在任务对象中留下可持久化的服务端引用。
