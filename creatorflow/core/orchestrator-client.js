/**
 * OrchestratorClient — CreatorFlow 编排服务客户端
 *
 * 负责：
 * - REST API 调用（创建任务、查询、控制）
 * - WebSocket 连接（实时事件接收）
 * - 事件转发到 EventBus
 */

export class OrchestratorClient {
  #baseUrl = 'http://localhost:18688';
  #ws = null;
  #clientId = crypto.randomUUID();
  #state = 'disconnected'; // disconnected | connecting | connected | reconnecting | error
  #eventBus;
  #reconnectAttempts = 0;
  #maxReconnectDelay = 30000; // 30s
  #reconnectTimer = null;

  constructor({ baseUrl, eventBus }) {
    if (baseUrl) this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#eventBus = eventBus;
  }

  // ── Properties ──────────────────────────────────────────

  /** Whether the WebSocket is currently connected. */
  get isConnected() {
    return this.#state === 'connected';
  }

  /** Current connection state string. */
  get connectionState() {
    return this.#state;
  }

  /** Base URL of the orchestrator service. */
  get baseUrl() {
    return this.#baseUrl;
  }

  /**
   * Update the server base URL and reconnect.
   * @param {string} url - New orchestrator server address
   */
  setBaseUrl(url) {
    this.#baseUrl = url.replace(/\/+$/, '');
    this.disconnect();
    this.connect();
  }

  // ── Connection Management ───────────────────────────────

  /**
   * Establish connection to the orchestrator service.
   * First tests the REST endpoint, then opens a WebSocket for real-time events.
   * Falls back to automatic reconnection on failure.
   */
  async connect() {
    this.#setState('connecting');
    try {
      const ok = await this.testConnection();
      if (!ok) {
        this.#setState('error');
        this.#scheduleReconnect();
        return;
      }
      this.#openWebSocket();
    } catch (err) {
      console.error('[Orchestrator] Connect failed:', err);
      this.#setState('error');
      this.#scheduleReconnect();
    }
  }

  /**
   * Gracefully disconnect from the orchestrator service.
   * Cancels any pending reconnect attempts and closes the WebSocket.
   */
  disconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempts = 0;
    if (this.#ws) {
      this.#ws.onclose = null; // Prevent reconnect on intentional close
      this.#ws.close();
      this.#ws = null;
    }
    this.#setState('disconnected');
  }

  /**
   * Probe the orchestrator REST API to verify the server is reachable.
   * @returns {Promise<boolean>} true if the server responded successfully
   */
  async testConnection() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${this.#baseUrl}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── REST API Methods ────────────────────────────────────

  /**
   * Internal helper for making timeout-aware REST requests.
   * @param {string} path - API path (e.g. /api/jobs, /api/upload)
   * @param {object} options - Fetch options including optional timeout override
   * @returns {Promise<object>} Parsed JSON response
   */
  async #request(path, options = {}) {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Health check endpoint.
   * @returns {Promise<object>} Server health status
   */
  async health() {
    return this.#request('/api/health', { timeout: 5000 });
  }

  /**
   * Create a new job by submitting workflow data.
   * @param {FormData} formData - Form data containing workflow and optional files
   * @returns {Promise<object>} Created job info including jobId
   */
  async createJob(formData) {
    return this.#request('/api/jobs', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * List all jobs.
   * @returns {Promise<object[]>} Array of job summaries
   */
  async listJobs() {
    return this.#request('/api/jobs', { timeout: 10000 });
  }

  /**
   * Get details of a specific job.
   * @param {string} jobId - Job identifier
   * @returns {Promise<object>} Job detail including status, segments, etc.
   */
  async getJob(jobId) {
    return this.#request(`/api/jobs/${jobId}`);
  }

  /**
   * Start executing a job.
   * @param {string} jobId - Job identifier
   * @returns {Promise<object>} Confirmation response
   */
  async startJob(jobId) {
    return this.#request(`/api/jobs/${jobId}/start`, { method: 'POST' });
  }

  /**
   * Cancel a running job.
   * @param {string} jobId - Job identifier
   * @returns {Promise<object>} Confirmation response
   */
  async cancelJob(jobId) {
    return this.#request(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  }

  /**
   * Retry a failed job.
   * @param {string} jobId - Job identifier
   * @returns {Promise<object>} Confirmation response
   */
  async retryJob(jobId) {
    return this.#request(`/api/jobs/${jobId}/retry`, { method: 'POST' });
  }

  /**
   * Get artifacts produced by a job.
   * @param {string} jobId - Job identifier
   * @returns {Promise<object[]>} Array of artifact metadata
   */
  async getArtifacts(jobId) {
    return this.#request(`/api/jobs/${jobId}/artifacts`);
  }

  /**
   * Upload a file to the orchestrator service.
   * @param {File} file - File object to upload
   * @returns {Promise<object>} Upload response with file identifier
   */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.#request('/api/upload', {
      method: 'POST',
      body: formData,
    });
  }

  // ── WebSocket ───────────────────────────────────────────

  /**
   * Open a WebSocket connection to receive real-time orchestrator events.
   * Handles job progress, segment updates, and status change notifications.
   * @private
   */
  #openWebSocket() {
    if (this.#ws) {
      this.#ws.close();
    }
    const wsUrl =
      this.#baseUrl.replace(/^http/, 'ws') +
      `/ws?clientId=${this.#clientId}`;
    this.#ws = new WebSocket(wsUrl);

    this.#ws.onopen = () => {
      this.#reconnectAttempts = 0;
      this.#setState('connected');
      console.log('[Orchestrator] WebSocket connected');
    };

    this.#ws.onmessage = (event) => {
      this.#onMessage(event);
    };

    this.#ws.onclose = () => {
      console.log('[Orchestrator] WebSocket closed');
      if (this.#state !== 'disconnected') {
        this.#setState('reconnecting');
        this.#scheduleReconnect();
      }
    };

    this.#ws.onerror = (err) => {
      console.error('[Orchestrator] WebSocket error:', err);
    };
  }

  /**
   * Parse and dispatch an incoming WebSocket message.
   * Routes events to the event bus with orchestrator: prefixed event names.
   * @private
   */
  #onMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      const { type, data, timestamp } = msg;

      // Emit specific event type
      this.#eventBus.emit(`orchestrator:${type}`, data);

      // Emit generic event
      this.#eventBus.emit('orchestrator:event', { type, data, timestamp });

      // Job-level events (e.g. job.created, job.completed, job.failed)
      if (type.startsWith('job.')) {
        this.#eventBus.emit('orchestrator:job', { type, data, timestamp });
      }

      // Segment-level events (e.g. segment.started, segment.completed)
      if (type.startsWith('segment.')) {
        this.#eventBus.emit('orchestrator:segment', { type, data, timestamp });
      }
    } catch {
      // Binary data or non-JSON payload -- silently ignore
    }
  }

  /**
   * Send a control message to the orchestrator via WebSocket.
   * @param {string} action - Control action (e.g. 'pause', 'resume')
   * @param {string} jobId - Target job identifier
   */
  sendControl(action, jobId) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      console.warn('[Orchestrator] Cannot send control, WebSocket not connected');
      return;
    }
    this.#ws.send(JSON.stringify({ action, jobId }));
  }

  // ── Reconnection ────────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Delay doubles each attempt, capped at #maxReconnectDelay (30s).
   * @private
   */
  #scheduleReconnect() {
    if (this.#state === 'disconnected') return;
    if (this.#reconnectTimer) return;
    const delay = Math.min(
      Math.pow(2, this.#reconnectAttempts) * 1000,
      this.#maxReconnectDelay,
    );
    this.#reconnectAttempts++;
    console.log(
      `[Orchestrator] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
    );
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Update the internal state and notify listeners via the event bus.
   * @param {string} state - New connection state
   * @private
   */
  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.#eventBus.emit('orchestrator:connection-changed', state);
  }
}
