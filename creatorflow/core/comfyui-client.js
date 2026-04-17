/**
 * ComfyUI REST + WebSocket Client
 *
 * Manages the bidirectional connection to a ComfyUI server instance.
 * Provides both REST API calls and real-time WebSocket message handling
 * with automatic reconnection and event-driven architecture.
 */
export class ComfyUIClient {
  #baseUrl = 'http://127.0.0.1:8188';
  #ws = null;
  #clientId = crypto.randomUUID();
  #state = 'disconnected'; // disconnected | connecting | connected | reconnecting | error
  #eventBus;
  #reconnectAttempts = 0;
  #maxReconnectDelay = 30000;
  #messageHandlers = new Map(); // type -> Set<handler>
  #reconnectTimer = null;

  constructor({ baseUrl, eventBus }) {
    if (baseUrl) this.#baseUrl = baseUrl;
    this.#eventBus = eventBus;
  }

  // ── Connection Management ──────────────────────────────────

  /**
   * Establish connection to ComfyUI server.
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
      console.error('[ComfyUI] Connect failed:', err);
      this.#setState('error');
      this.#scheduleReconnect();
    }
  }

  /**
   * Gracefully disconnect from ComfyUI.
   * Cancels any pending reconnect attempts and closes the WebSocket.
   */
  disconnect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempts = 0;
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#setState('disconnected');
  }

  /**
   * Probe the ComfyUI REST API to verify the server is reachable.
   * @returns {Promise<boolean>} true if the server responded successfully
   */
  async testConnection() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${this.#baseUrl}/system_stats`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) return true;
      // 403 typically means CORS is blocking or ComfyUI denied the request
      if (resp.status === 403) {
        console.error(
          '[ComfyUI] 403 Forbidden — ComfyUI is running but blocking cross-origin requests.',
          'Start ComfyUI with --enable-cors-header flag to allow access.',
          'Example: python main.py --enable-cors-header',
        );
      }
      return false;
    } catch (err) {
      // TypeError from fetch = network failure (server down or CORS blocked)
      if (err instanceof TypeError) {
        console.error(
          '[ComfyUI] Network error — ComfyUI may not be running,',
          'or CORS is blocking the request.',
          'If ComfyUI is running, restart it with: python main.py --enable-cors-header',
        );
      }
      return false;
    }
  }

  /** Whether the WebSocket is currently connected. */
  get isConnected() {
    return this.#state === 'connected';
  }

  /** Current connection state string. */
  get connectionState() {
    return this.#state;
  }

  /**
   * Update the server base URL and reconnect.
   * @param {string} url - New ComfyUI server address (e.g. http://192.168.1.5:8188)
   */
  setBaseUrl(url) {
    this.#baseUrl = url.replace(/\/+$/, '');
    this.disconnect();
    this.connect();
  }

  // ── REST API ───────────────────────────────────────────────

  /**
   * Internal helper for making authenticated, timeout-aware REST requests.
   * @param {string} path - API path (e.g. /prompt, /queue)
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
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Submit a workflow prompt for execution.
   * @param {object} workflow - The full ComfyUI API-format workflow JSON
   * @returns {Promise<object>} Response containing prompt_id and queue info
   */
  async submitPrompt(workflow) {
    return this.#request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.#clientId }),
      timeout: 30000,
    });
  }

  /**
   * Retrieve execution history for a specific prompt.
   * @param {string} promptId - The prompt UUID returned by submitPrompt
   * @returns {Promise<object>} History record with outputs and status
   */
  async getHistory(promptId) {
    return this.#request(`/history/${promptId}`, { timeout: 10000 });
  }

  /**
   * Get the current execution queue state.
   * @returns {Promise<object>} Queue info with running and pending entries
   */
  async getQueue() {
    return this.#request('/queue', { timeout: 5000 });
  }

  /**
   * Interrupt the currently running prompt execution.
   * @returns {Promise<object>} Confirmation response
   */
  async interrupt() {
    return this.#request('/interrupt', { method: 'POST', timeout: 5000 });
  }

  // ── File Access ────────────────────────────────────────────

  /**
   * Build a URL for viewing/reading a file from the ComfyUI server.
   * @param {object} params
   * @param {string} params.filename - Name of the file
   * @param {string} [params.subfolder=''] - Subfolder within the type directory
   * @param {string} [params.type='output'] - File category (output, input, temp)
   * @returns {string} Full URL to the file via the /view endpoint
   */
  getViewUrl({ filename, subfolder = '', type = 'output' }) {
    const params = new URLSearchParams({ filename, subfolder, type });
    return `${this.#baseUrl}/view?${params}`;
  }

  // ── WebSocket ──────────────────────────────────────────────

  /**
   * Open a WebSocket connection to receive real-time execution events.
   * Handles progress updates, execution completion, and error notifications.
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
      console.log('[ComfyUI] WebSocket connected');
    };

    this.#ws.onmessage = (event) => {
      this.#onMessage(event);
    };

    this.#ws.onclose = () => {
      console.log('[ComfyUI] WebSocket closed');
      if (this.#state !== 'disconnected') {
        this.#setState('reconnecting');
        this.#scheduleReconnect();
      }
    };

    this.#ws.onerror = (err) => {
      console.error('[ComfyUI] WebSocket error:', err);
    };
  }

  /**
   * Parse and dispatch an incoming WebSocket message.
   * Routes messages to registered handlers and the event bus.
   * @private
   */
  #onMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      const type = msg.type || msg.data?.type;
      const data = msg.data || msg;

      if (type) {
        // Dispatch to locally registered handlers
        const handlers = this.#messageHandlers.get(type);
        if (handlers) {
          for (const h of handlers) {
            try {
              h(data);
            } catch (e) {
              console.error(`[ComfyUI] Handler error for "${type}":`, e);
            }
          }
        }
        // Also emit to the global event bus for module consumption
        this.#eventBus.emit(`comfy:ws:${type}`, data);
      }
    } catch {
      // Binary data or non-JSON payload -- silently ignore
    }
  }

  /**
   * Register a handler for a specific WebSocket message type.
   * @param {string} type - Message type (e.g. 'progress', 'executing', 'executed')
   * @param {Function} handler - Callback receiving the message data
   * @returns {Function} Unsubscribe function
   */
  onMessage(type, handler) {
    if (!this.#messageHandlers.has(type)) {
      this.#messageHandlers.set(type, new Set());
    }
    this.#messageHandlers.get(type).add(handler);
    return () => {
      const handlers = this.#messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  // ── Reconnection ───────────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Delay doubles each attempt, capped at #maxReconnectDelay (30s).
   * @private
   */
  #scheduleReconnect() {
    if (this.#state === 'disconnected') return;
    const delay = Math.min(
      Math.pow(2, this.#reconnectAttempts) * 1000,
      this.#maxReconnectDelay,
    );
    this.#reconnectAttempts++;
    console.log(
      `[ComfyUI] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
    );
    this.#reconnectTimer = setTimeout(() => {
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
    this.#eventBus.emit('comfy:connection-changed', state);
  }
}
