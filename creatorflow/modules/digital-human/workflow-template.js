const NODE_MAP = {
  IMAGE:          { nodeId: '444',  field: 'image' },
  AUDIO:          { nodeId: '1594', field: 'audio' },
  PROMPT:         { nodeId: '1624', field: 'value' },
  SEED:           { nodeId: '1527', field: 'value' },
  DURATION:       { nodeId: '1583', field: 'value' },
  FPS:            { nodeId: '1586', field: 'value' },
  MAX_RESOLUTION: { nodeId: '1606', field: 'value' },
  OUTPUT:         { nodeId: '1747' },
  OUTPUT_PREFIX:  { nodeId: '1747', field: 'filename_prefix' }
};

let templateCache = null;

export async function loadTemplate() {
  if (templateCache) return templateCache;
  const resp = await fetch('./assets/workflows/ltx23-digital-human-api.json');
  if (!resp.ok) throw new Error(`Failed to load workflow template: ${resp.status}`);
  templateCache = await resp.json();
  return templateCache;
}

export function clearTemplateCache() {
  templateCache = null;
}

export function buildWorkflow(template, task) {
  const wf = structuredClone(template);

  wf[NODE_MAP.IMAGE.nodeId].inputs[NODE_MAP.IMAGE.field] = task.image.uploadedName;
  wf[NODE_MAP.AUDIO.nodeId].inputs[NODE_MAP.AUDIO.field] = task.audio.uploadedName;
  wf[NODE_MAP.PROMPT.nodeId].inputs[NODE_MAP.PROMPT.field] = task.prompt;
  wf[NODE_MAP.SEED.nodeId].inputs[NODE_MAP.SEED.field] = task.seed;
  wf[NODE_MAP.DURATION.nodeId].inputs[NODE_MAP.DURATION.field] = task.duration;
  wf[NODE_MAP.FPS.nodeId].inputs[NODE_MAP.FPS.field] = task.fps;
  wf[NODE_MAP.MAX_RESOLUTION.nodeId].inputs[NODE_MAP.MAX_RESOLUTION.field] = task.maxResolution;
  wf[NODE_MAP.OUTPUT_PREFIX.nodeId].inputs[NODE_MAP.OUTPUT_PREFIX.field] =
    `creatorflow-dh-${task.id}-${Date.now()}`;

  return wf;
}

export function extractResult(historyData, promptId, getViewUrl) {
  const entry = historyData[promptId];
  if (!entry) return { success: false, error: '未找到执行历史' };

  const outputs = entry.outputs;
  if (!outputs) return { success: false, error: '输出为空' };

  // Find output from node 1747 (VHS_VideoCombine)
  const outputNode = outputs[NODE_MAP.OUTPUT.nodeId];
  if (!outputNode) return { success: false, error: '未找到视频输出节点' };

  // The output may contain 'videos' or 'gifs' array
  const videos = outputNode.videos || outputNode.gifs || [];
  if (videos.length === 0) return { success: false, error: '输出视频为空' };

  const video = videos[0];
  return {
    success: true,
    filename: video.filename,
    subfolder: video.subfolder || '',
    type: video.type || 'output',
    videoUrl: getViewUrl({
      filename: video.filename,
      subfolder: video.subfolder || '',
      type: video.type || 'output'
    })
  };
}

export { NODE_MAP };
