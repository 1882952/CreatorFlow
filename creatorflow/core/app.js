/**
 * CreatorFlow Application Entry Point
 * Initializes all core services and manages module lifecycle
 */
import { Router } from './router.js';
import { EventBus } from './event-bus.js';
import { Storage } from './storage.js';
import { ComfyUIClient } from './comfyui-client.js';
import { OrchestratorClient } from './orchestrator-client.js';
import { FileUploader } from './file-uploader.js';
import assetsModule from '../modules/assets/index.js';
import digitalHumanModule from '../modules/digital-human/index.js';
import settingsModule from '../modules/settings/index.js';

// ── App Context (shared singleton) ─────────────────────────
const appContext = {
  router: null,
  eventBus: null,
  storage: null,
  rootEl: null,
  comfyClient: null,
  orchestratorClient: null,
  fileUploader: null,
  _modules: new Map(),
  _activeModule: null,
};

// ── Toast Helper ───────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Module Registration ────────────────────────────────────
function registerModule(moduleDef) {
  if (!moduleDef.id || !moduleDef.route) {
    console.error('[App] Module must have id and route');
    return;
  }
  appContext._modules.set(moduleDef.id, moduleDef);
  appContext.router.register(moduleDef.route, (path) => {
    mountModule(moduleDef.id);
  });
  console.log(`[App] Module registered: ${moduleDef.id} → ${moduleDef.route}`);
}

function mountModule(moduleId) {
  const moduleDef = appContext._modules.get(moduleId);
  if (!moduleDef) return;

  // Unmount current module
  if (appContext._activeModule && appContext._activeModule.unmount) {
    appContext._activeModule.unmount();
  }

  // Update nav active state
  document.querySelectorAll('.nav-item[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === moduleDef.route);
  });

  // Mount new module
  const headerSlot = document.getElementById('module-header-slot');
  const contentSlot = document.getElementById('module-content-slot');
  headerSlot.innerHTML = '';
  contentSlot.innerHTML = '';

  moduleDef.mount({ headerSlot, contentSlot, app: appContext });

  appContext._activeModule = moduleDef;
  appContext.eventBus.emit('module:mount', { moduleId });
  appContext.eventBus.emit('app:route-changed', { path: moduleDef.route });
}

// ── Sidebar Toggle ─────────────────────────────────────────
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');

  // Restore collapsed state
  const collapsed = appContext.storage.get('sidebarCollapsed', false);
  if (collapsed) sidebar.classList.add('collapsed');

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    appContext.storage.set('sidebarCollapsed', isCollapsed);
    appContext.eventBus.emit('app:sidebar-toggle', { collapsed: isCollapsed });
  });
}

// ── Sidebar Navigation ─────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item[data-route]').forEach(el => {
    el.addEventListener('click', () => {
      const route = el.dataset.route;
      if (route) {
        appContext.router.navigate(route);
      }
    });
  });
}

// ── Status Bar ─────────────────────────────────────────────
function updateConnectionStatus(state) {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) return;

  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('span:last-child');

  dot.className = 'status-dot';

  switch (state) {
    case 'connected':
      dot.classList.add('connected');
      text.textContent = '已连接';
      break;
    case 'reconnecting':
      dot.classList.add('reconnecting');
      text.textContent = '重连中...';
      break;
    case 'connecting':
      dot.classList.add('reconnecting');
      text.textContent = '连接中...';
      break;
    default:
      dot.classList.add('disconnected');
      text.textContent = '未连接';
  }
}

function updateQueueSummary(running, total) {
  const el = document.getElementById('queue-summary');
  if (el) {
    el.textContent = running > 0 ? `执行中 ${running}/${total}` : '队列空闲';
  }
}

function updateServerAddress(address) {
  const el = document.getElementById('server-address');
  if (el) {
    el.textContent = address || 'http://127.0.0.1:8188';
  }
}

// ── App Initialization ─────────────────────────────────────
async function init() {
  console.log('[App] CreatorFlow initializing...');

  // Init core services
  const eventBus = new EventBus();
  const storage = new Storage();
  const router = new Router();

  appContext.router = router;
  appContext.eventBus = eventBus;
  appContext.storage = storage;
  appContext.rootEl = document.getElementById('app-shell');

  // Expose globally for console debugging
  window.__cf = appContext;
  window.__cf.showToast = showToast;

  // Init sidebar
  initSidebar();
  initNavigation();

  // Register real modules
  registerModule(assetsModule);
  registerModule(digitalHumanModule);
  registerModule(settingsModule);

  // Restore server address
  const settings = storage.get('settings', {});
  if (settings.comfyBaseUrl) {
    updateServerAddress(settings.comfyBaseUrl);
  }

  // Init ComfyUI client and file uploader BEFORE starting router
  // (modules need these services when they mount)
  const comfyClient = new ComfyUIClient({
    baseUrl: settings.comfyBaseUrl || undefined,
    eventBus,
  });
  const fileUploader = new FileUploader(comfyClient);

  appContext.comfyClient = comfyClient;
  appContext.fileUploader = fileUploader;

  // Init Orchestrator client if configured
  const execMode = settings.executionMode || 'orchestrated';
  const orchUrl = settings.orchestratorBaseUrl;
  if (orchUrl && execMode !== 'direct') {
    const orchClient = new OrchestratorClient({ baseUrl: orchUrl, eventBus });
    appContext.orchestratorClient = orchClient;
    orchClient.connect();
    console.log('[App] Orchestrator client initialized:', orchUrl);
  }

  // Event listeners for status bar updates
  eventBus.on('comfy:connection-changed', (state) => {
    updateConnectionStatus(state);
  });

  eventBus.on('app:statusbar-update', (data) => {
    if (data.connectionState !== undefined) updateConnectionStatus(data.connectionState);
    if (data.queueRunning !== undefined) updateQueueSummary(data.queueRunning, data.queueTotal || 0);
    if (data.serverAddress !== undefined) updateServerAddress(data.serverAddress);
  });

  // Start router (triggers module mount, which needs comfyClient/fileUploader)
  router.start();

  // Mark connection as disconnected until ComfyUI client connects
  updateConnectionStatus('disconnected');

  // Connect to ComfyUI
  comfyClient.connect();

  console.log('[App] CreatorFlow initialized. Context available as window.__cf');
}

// Boot
document.addEventListener('DOMContentLoaded', init);
