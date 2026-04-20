# Spike 可行性验证脚本

在正式开发前，运行以下脚本验证关键技术假设。

## 前置条件

- Python 3.11+
- ffmpeg / ffprobe 在 PATH 中
- ComfyUI 运行在 http://127.0.0.1:8188（S1 需要）

## 安装依赖

```bash
pip install requests
```

## 运行方式

### Spike S1: 时长校准

验证 ComfyUI 工作流在不同 duration 参数下的实际输出时长。

```bash
python spike_s1_duration_calibration.py \
    --image path/to/reference.jpg \
    --audio path/to/audio.mp3 \
    --comfyui-url http://127.0.0.1:8188
```

需要 ComfyUI 正在运行，会自动提交 4 个不同时长的任务。

### Spike S2: 尾帧抽取质量

验证 ffmpeg 尾帧抽取的最佳参数。

```bash
python spike_s2_tail_frame_extraction.py --video path/to/test_video.mp4
```

只需 ffmpeg，不需要 ComfyUI。

### Spike S3: Concat 拼接兼容性

验证多段视频能否无损拼接。

```bash
python spike_s3_concat_compatibility.py --videos v1.mp4 v2.mp4
```

只需 ffmpeg，不需要 ComfyUI。

## 结果

所有结果保存在 `results/` 目录下：
- `spike_s1_results.json` — 时长映射表
- `spike_s2_results.json` — 尾帧抽取参数建议
- `spike_s3_results.json` — 拼接兼容性结论
