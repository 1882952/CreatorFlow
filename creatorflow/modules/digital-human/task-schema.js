let taskCounter = 0;

export function createTask(overrides = {}) {
  taskCounter++;
  const id = `task_${String(taskCounter).padStart(3, '0')}_${Date.now()}`;
  return {
    id,
    name: `任务 ${String(taskCounter).padStart(3, '0')}`,
    selected: true,
    status: 'draft',
    validation: { valid: false, errors: [] },
    image: {
      originalName: null,
      uploadedName: null,
      previewUrl: null,
      size: null,
      width: null,
      height: null,
      uploadState: 'idle'
    },
    audio: {
      originalName: null,
      uploadedName: null,
      previewUrl: null,
      size: null,
      duration: null,
      uploadState: 'idle'
    },
    prompt: '',
    seed: 42,
    duration: 6,
    fps: 30,
    maxResolution: 1280,
    promptId: null,
    progress: 0,
    progressLabel: '',
    currentNode: null,
    error: null,
    output: { filename: null, subfolder: null, type: null, videoUrl: null },
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

export function cloneTask(task) {
  return createTask({
    name: `${task.name} (副本)`,
    prompt: task.prompt,
    seed: task.seed,
    duration: task.duration,
    fps: task.fps,
    maxResolution: task.maxResolution,
  });
}

export function normalizeTask(task) {
  // Duration: clamp to 1-10
  task.duration = Math.max(1, Math.min(10, Number(task.duration) || 6));
  // FPS: clamp to 1-60
  task.fps = Math.max(1, Math.min(60, Number(task.fps) || 30));
  // MaxResolution: only allow 768 | 1024 | 1280
  const allowed = [768, 1024, 1280];
  if (!allowed.includes(Number(task.maxResolution))) task.maxResolution = 1280;
  // Running/uploading/queued → ready (after page refresh)
  if (['running', 'uploading', 'queued'].includes(task.status)) task.status = 'ready';
  // Ensure nested objects exist
  if (!task.image) task.image = { originalName: null, uploadedName: null, previewUrl: null, size: null, width: null, height: null, uploadState: 'idle' };
  if (!task.audio) task.audio = { originalName: null, uploadedName: null, previewUrl: null, size: null, duration: null, uploadState: 'idle' };
  if (!task.output) task.output = { filename: null, subfolder: null, type: null, videoUrl: null };
  if (!task.validation) task.validation = { valid: false, errors: [] };
  return task;
}

export function validateTask(task) {
  const errors = [];
  if (!task.image || !task.image.uploadedName) errors.push('请上传参考图');
  if (!task.audio || !task.audio.uploadedName) errors.push('请上传音频');
  if (!task.prompt || !task.prompt.trim()) errors.push('请输入提示词');

  task.validation = { valid: errors.length === 0, errors };

  // Status transitions based on validation
  if (task.status === 'draft' && task.validation.valid) task.status = 'ready';
  if (task.status === 'ready' && !task.validation.valid) task.status = 'draft';

  return task.validation;
}

export function resetTaskCounter() {
  taskCounter = 0;
}

export function getTaskCounter() {
  return taskCounter;
}

export function setTaskCounter(val) {
  taskCounter = val;
}
