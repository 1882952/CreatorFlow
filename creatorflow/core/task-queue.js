import { validateTask } from '../modules/digital-human/task-schema.js';
import { loadTemplate, buildWorkflow, extractResult } from '../modules/digital-human/workflow-template.js';

/**
 * Task Queue Engine for CreatorFlow
 *
 * Orchestrates sequential execution of digital human generation tasks
 * via the ComfyUI backend. Manages lifecycle, progress tracking,
 * WebSocket correlation, and pause/stop/retry semantics.
 */
export class TaskQueue {
  // ── Private State ──────────────────────────────────────────
  #client;
  #eventBus;
  #tasks = null;
  #state = 'idle'; // idle | running | pause_requested | stopping | completed
  #currentIndex = -1;
  #promptTaskMap = new Map(); // promptId -> taskId
  #template = null;
  #unsubscribers = []; // WebSocket handler cleanup functions
  #currentPromptId = null; // resolve function for the current task's execution promise

  /**
   * @param {object} options
   * @param {ComfyUIClient} options.client - Connected ComfyUI client instance
   * @param {EventBus} options.eventBus - Application event bus for cross-module communication
   */
  constructor({ client, eventBus }) {
    this.#client = client;
    this.#eventBus = eventBus;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Set the external tasks array reference.
   * The queue does not own the array; it operates on the same reference
   * the rest of the application uses.
   * @param {Array} tasks
   */
  setTasks(tasks) {
    this.#tasks = tasks;
  }

  /** Whether the queue is currently executing tasks. */
  get isRunning() {
    return this.#state === 'running';
  }

  /** Current queue state string. */
  get state() {
    return this.#state;
  }

  /**
   * Execution progress across all selected+ready tasks.
   * @returns {{ current: number, total: number, percent: number }}
   */
  get progress() {
    const candidates = this.#getCandidates();
    const total = candidates.length;
    const current = Math.max(0, this.#currentIndex + 1);
    return {
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
    };
  }

  /**
   * Begin executing all selected tasks whose status is 'ready'.
   * Tasks are processed sequentially; the queue returns to idle
   * when all tasks are done or a pause/stop is requested.
   */
  async start() {
    if (this.#state === 'running') {
      console.log('[TaskQueue] Already running, ignoring start()');
      return;
    }

    const candidates = this.#getCandidates();
    if (candidates.length === 0) {
      console.log('[TaskQueue] No ready tasks to execute');
      return;
    }

    this.#state = 'running';
    this.#currentIndex = -1;
    this.#registerWsHandlers();

    this.#emit('queue:started', { total: candidates.length });
    this.#log('Queue started', `Tasks: ${candidates.length}`);

    for (let i = 0; i < candidates.length; i++) {
      // ── Pause check (between tasks, not mid-task) ─────────
      if (this.#state === 'pause_requested') {
        this.#state = 'idle';
        this.#cleanupWsHandlers();
        this.#emit('queue:paused', { stoppedAt: i, total: candidates.length });
        this.#log('Queue paused', `Stopped before task ${i + 1}/${candidates.length}`);
        return;
      }

      // ── Stop check ────────────────────────────────────────
      if (this.#state === 'stopping') {
        this.#state = 'idle';
        this.#cleanupWsHandlers();
        this.#emit('queue:stopped', { stoppedAt: i });
        this.#log('Queue stopped');
        return;
      }

      this.#currentIndex = i;
      const task = candidates[i];

      // The external tasks array may have been mutated between iterations
      if (!task || task.status !== 'ready') {
        this.#log('Skipping task', task?.id ?? '(unknown)', '- status is no longer ready');
        continue;
      }

      try {
        await this.#executeTask(task);
      } catch (err) {
        console.error(`[TaskQueue] Unhandled error executing task ${task.id}:`, err);
        task.status = 'failed';
        task.error = err.message || 'Unknown execution error';
        this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
        this.#log('Task failed', task.id, task.error);
        // Continue to next task
      }
    }

    // All tasks processed
    this.#state = 'completed';
    this.#currentIndex = -1;
    this.#cleanupWsHandlers();
    this.#emit('queue:completed', { total: candidates.length });
    this.#log('Queue completed', `All ${candidates.length} tasks processed`);
  }

  /**
   * Request a pause. The currently running task finishes naturally,
   * then execution halts before the next task begins.
   */
  pause() {
    if (this.#state !== 'running') return;
    this.#state = 'pause_requested';
    this.#log('Pause requested - will stop after current task');
  }

  /**
   * Immediately stop execution.
   * Sends an interrupt to ComfyUI, marks the current task as cancelled,
   * and transitions to idle.
   */
  async stop() {
    if (this.#state !== 'running' && this.#state !== 'pause_requested') return;

    this.#state = 'stopping';

    try {
      await this.#client.interrupt();
      this.#log('Interrupt sent to ComfyUI');
    } catch (err) {
      console.error('[TaskQueue] Failed to interrupt ComfyUI:', err);
    }

    // Mark the current task as cancelled
    if (this.#tasks && this.#currentIndex >= 0) {
      const candidates = this.#getCandidates();
      const task = candidates[this.#currentIndex];
      if (task && task.status === 'running') {
        task.status = 'failed';
        task.error = 'Cancelled by user';
        this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
      }
    }

    // Resolve any pending execution promise so the start() loop can exit
    if (this.#currentPromptId) {
      this.#currentPromptId({ cancelled: true });
      this.#currentPromptId = null;
    }

    this.#state = 'idle';
    this.#currentIndex = -1;
    this.#cleanupWsHandlers();
    this.#promptTaskMap.clear();
    this.#emit('queue:stopped', {});
    this.#log('Queue stopped');
  }

  /**
   * Reset all failed tasks back to 'ready' status so they can be retried.
   * @returns {number} Number of tasks that were reset
   */
  retryFailed() {
    if (!this.#tasks) return 0;

    let count = 0;
    for (const task of this.#tasks) {
      if (task.status === 'failed') {
        task.status = 'ready';
        task.error = null;
        task.progress = 0;
        task.progressLabel = '';
        task.currentNode = null;
        task.promptId = null;
        count++;
      }
    }

    if (count > 0) {
      this.#log('Retry: reset', count, 'failed tasks to ready');
    }
    return count;
  }

  /**
   * Clean up all WebSocket handlers. Call when the queue is being discarded.
   */
  destroy() {
    this.#cleanupWsHandlers();
    this.#promptTaskMap.clear();
    this.#template = null;
    this.#tasks = null;
    this.#state = 'idle';
  }

  // ── Task Execution Pipeline ────────────────────────────────

  /**
   * Execute a single task through the full pipeline:
   * validate -> build workflow -> submit -> wait for completion -> extract result
   * @param {object} task - The task object to execute
   */
  async #executeTask(task) {
    // Step 1: Validate
    const validation = validateTask(task);
    if (!validation.valid) {
      task.status = 'failed';
      task.error = validation.errors.join('; ');
      this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
      this.#log('Task validation failed', task.id, task.error);
      return;
    }

    // Step 2: Mark as running
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.progress = 0;
    task.progressLabel = 'Starting...';
    task.currentNode = null;
    task.error = null;
    this.#emit('queue:task-started', { taskId: task.id });
    this.#log('Task started', task.id);

    try {
      // Step 3: Load template (cached after first load)
      if (!this.#template) {
        this.#template = await loadTemplate();
      }

      // Step 4: Build workflow from template + task parameters
      const workflow = buildWorkflow(this.#template, task);

      // Step 5: Submit to ComfyUI
      const result = await this.#client.submitPrompt(workflow);
      const promptId = result.prompt_id;
      task.promptId = promptId;

      // Step 6: Build promptId -> taskId mapping for WebSocket correlation
      this.#promptTaskMap.set(promptId, task.id);

      this.#log('Prompt submitted', task.id, 'promptId:', promptId);

      // Step 7: Wait for execution to complete via WebSocket
      const outcome = await this.#waitForCompletion(promptId, task);

      if (outcome.cancelled) {
        // Task was cancelled via stop()
        return;
      }

      if (outcome.error) {
        task.status = 'failed';
        task.error = outcome.error;
        this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
        this.#log('Task execution error', task.id, outcome.error);
        return;
      }

      // Step 8: Fetch history and extract result
      const historyData = await this.#client.getHistory(promptId);
      const extracted = extractResult(historyData, promptId, (params) =>
        this.#client.getViewUrl(params),
      );

      if (!extracted.success) {
        task.status = 'failed';
        task.error = extracted.error || 'Failed to extract output';
        this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
        this.#log('Result extraction failed', task.id, task.error);
        return;
      }

      // Step 9: Mark as completed with output
      task.output = {
        filename: extracted.filename,
        subfolder: extracted.subfolder,
        type: extracted.type,
        videoUrl: extracted.videoUrl,
      };
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.progress = 100;
      task.progressLabel = 'Completed';
      this.#emit('queue:task-completed', { taskId: task.id, output: task.output });
      this.#log('Task completed', task.id);
    } catch (err) {
      task.status = 'failed';
      task.error = err.message || 'Unknown error during execution';
      this.#emit('queue:task-failed', { taskId: task.id, error: task.error });
      this.#log('Task failed', task.id, task.error);
    } finally {
      // Clean up mapping for this task's prompt
      if (task.promptId) {
        this.#promptTaskMap.delete(task.promptId);
      }
    }
  }

  // ── WebSocket Orchestration ────────────────────────────────

  /**
   * Register handlers for ComfyUI WebSocket message types.
   * Each handler is stored with its unsubscribe function for later cleanup.
   */
  #registerWsHandlers() {
    this.#cleanupWsHandlers();

    const on = (type, handler) => {
      const unsub = this.#client.onMessage(type, handler);
      this.#unsubscribers.push(unsub);
    };

    on('progress', (data) => {
      const taskId = this.#promptTaskMap.get(data.prompt_id);
      if (!taskId) return;
      const task = this.#findTaskById(taskId);
      if (!task || task.status !== 'running') return;

      const value = data.value ?? 0;
      const max = data.max ?? 1;
      const percent = max > 0 ? Math.round((value / max) * 100) : 0;

      task.progress = percent;
      task.progressLabel = `${value}/${max}`;
      this.#emit('queue:task-progress', { taskId, progress: percent, value, max });
    });

    on('executing', (data) => {
      const taskId = this.#promptTaskMap.get(data.prompt_id);
      if (!taskId) return;
      const task = this.#findTaskById(taskId);
      if (!task || task.status !== 'running') return;

      const node = data.node || null;
      task.currentNode = node;
      if (node) {
        task.progressLabel = `Executing node: ${node}`;
        this.#emit('queue:task-progress', { taskId, currentNode: node });
      }
    });

    on('execution_start', (data) => {
      const taskId = this.#promptTaskMap.get(data.prompt_id);
      if (!taskId) return;
      const task = this.#findTaskById(taskId);
      if (!task || task.status !== 'running') return;

      task.progressLabel = 'Execution started';
      this.#log('Execution started for prompt', data.prompt_id);
    });

    on('executed', (data) => {
      // ComfyUI sends 'executed' when a node finishes.
      // The final output node (1747) completing signals workflow completion.
      const promptId = data.prompt_id;
      if (this.#currentPromptId && this.#promptTaskMap.has(promptId)) {
        this.#currentPromptId({ completed: true });
        this.#currentPromptId = null;
      }
    });

    on('execution_complete', (data) => {
      const promptId = data.prompt_id;
      if (this.#currentPromptId && this.#promptTaskMap.has(promptId)) {
        this.#currentPromptId({ completed: true });
        this.#currentPromptId = null;
      }
    });

    on('execution_error', (data) => {
      const promptId = data.prompt_id;
      if (this.#currentPromptId && this.#promptTaskMap.has(promptId)) {
        const errorMsg =
          data.exception_message || data.message || 'ComfyUI execution error';
        this.#currentPromptId({ error: errorMsg });
        this.#currentPromptId = null;
      }
    });
  }

  /**
   * Unsubscribe all registered WebSocket handlers.
   */
  #cleanupWsHandlers() {
    for (const unsub of this.#unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.#unsubscribers = [];
  }

  /**
   * Create a promise that resolves when the ComfyUI execution for the given
   * promptId finishes (either success, error, or cancellation).
   * @param {string} promptId
   * @param {object} task - Task being executed (for timeout tracking)
   * @returns {Promise<{completed?: boolean, error?: string, cancelled?: boolean}>}
   */
  #waitForCompletion(promptId, task) {
    return new Promise((resolve) => {
      // Store the resolve function so WebSocket handlers can call it
      this.#currentPromptId = resolve;

      // Safety timeout: 10 minutes per task (video generation can be slow)
      const timeout = setTimeout(() => {
        if (this.#currentPromptId === resolve) {
          this.#currentPromptId = null;
          resolve({ error: 'Execution timed out (10 min)' });
        }
      }, 10 * 60 * 1000);

      // Wrap resolve to also clear the timeout
      const originalResolve = resolve;
      resolve = (value) => {
        clearTimeout(timeout);
        originalResolve(value);
      };
      this.#currentPromptId = resolve;
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Get tasks that are both selected and in 'ready' status.
   * Filters from the current state of the tasks array (may change between calls).
   * @returns {Array<object>}
   */
  #getCandidates() {
    if (!this.#tasks) return [];
    return this.#tasks.filter((t) => t.selected && t.status === 'ready');
  }

  /**
   * Find a task in the tasks array by its id.
   * @param {string} taskId
   * @returns {object|undefined}
   */
  #findTaskById(taskId) {
    if (!this.#tasks) return undefined;
    return this.#tasks.find((t) => t.id === taskId);
  }

  /**
   * Emit an event on the event bus.
   * @param {string} event
   * @param {*} data
   */
  #emit(event, data) {
    try {
      this.#eventBus.emit(event, data);
    } catch (err) {
      console.error(`[TaskQueue] Error emitting ${event}:`, err);
    }
  }

  /**
   * Log a message with the [TaskQueue] prefix.
   * @param {...*} args
   */
  #log(...args) {
    console.log('[TaskQueue]', ...args);
    this.#emit('queue:log', { message: args.join(' '), type: 'info' });
  }
}
