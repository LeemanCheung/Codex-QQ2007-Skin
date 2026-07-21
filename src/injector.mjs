import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectTokenStats } from './token-stats.mjs';

const VERSION = '1.0.0';
const MAIN_URL = 'app://-/index.html';
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const COMMANDS = new Set(['apply', 'remove', 'verify', 'inspect', 'screenshot', 'watch']);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

function parseArguments(argv) {
  const options = {
    command: 'verify',
    port: 9335,
    output: null,
    assetRoot: path.join(PACKAGE_ROOT, 'assets'),
    readyFile: null,
    enable: false,
    interval: 1200,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (COMMANDS.has(value)) options.command = value;
    else if (value === '--port') options.port = Number(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--asset-root') options.assetRoot = path.resolve(argv[++index]);
    else if (value === '--ready-file') options.readyFile = path.resolve(argv[++index]);
    else if (value === '--enable') options.enable = true;
    else if (value === '--interval') options.interval = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid loopback debugging port: ${options.port}`);
  }
  if (!Number.isInteger(options.interval) || options.interval < 500 || options.interval > 10000) {
    throw new Error(`Invalid watch interval: ${options.interval}`);
  }
  if (options.command === 'screenshot' && !options.output) {
    throw new Error('screenshot requires --output <png-path>');
  }
  return options;
}

function validateTarget(target, port) {
  if (target?.type !== 'page' || target.url !== MAIN_URL) return null;
  let websocket;
  try {
    websocket = new URL(target.webSocketDebuggerUrl);
  } catch {
    return null;
  }
  if (
    websocket.protocol !== 'ws:'
    || !LOOPBACK_NAMES.has(websocket.hostname)
    || Number(websocket.port) !== port
    || !/^\/devtools\/page\/[A-Za-z0-9._-]+$/.test(websocket.pathname)
    || websocket.username
    || websocket.password
    || websocket.search
    || websocket.hash
  ) return null;
  return { ...target, verifiedWebSocketUrl: websocket.href };
}

async function discoverTarget(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CDP discovery returned HTTP ${response.status}`);
    const targets = await response.json();
    if (!Array.isArray(targets)) throw new Error('CDP discovery payload is not an array');
    const verified = targets.map((target) => validateTarget(target, port)).find(Boolean);
    if (!verified) throw new Error(`No verified Codex renderer on 127.0.0.1:${port}`);
    return verified;
  } finally {
    clearTimeout(timeout);
  }
}

class CdpSession {
  constructor(websocketUrl) {
    this.websocketUrl = websocketUrl;
    this.socket = new WebSocket(websocketUrl);
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP WebSocket open timed out')), 5000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('CDP WebSocket open failed'));
      }, { once: true });
    });

    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
    });

    this.socket.addEventListener('close', () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });

    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP session is not open for ${method}`));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        ?? response.exceptionDetails.text
        ?? 'unknown renderer error';
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return response.result?.value;
  }

  close() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Best-effort close.
    }
  }
}

async function dataUrl(filePath, mimeType) {
  const data = await fs.readFile(filePath);
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

async function buildBootstrap(assetRoot, tokenStats) {
  const [css, runtime] = await Promise.all([
    fs.readFile(path.join(SCRIPT_DIRECTORY, 'skin.css'), 'utf8'),
    fs.readFile(path.join(SCRIPT_DIRECTORY, 'skin-runtime.js'), 'utf8'),
  ]);
  const assetFiles = {
    titleBg: 'codex2007-title-bg.png',
    toolbarBg: 'codex2007-toolbar-bg.png',
    panelHeaderBg: 'codex2007-panel-header-bg.png',
    statusBg: 'codex2007-status-bg.png',
    windowControls: 'codex2007-window-controls.png',
    penguin2007: 'codex2007-penguin.png',
    toolNew: 'codex2007-tool-new.png',
    toolScheduled: 'codex2007-tool-scheduled.png',
    toolPlugins: 'codex2007-tool-plugins.png',
    toolSites: 'codex2007-tool-sites.png',
    toolPullRequests: 'codex2007-tool-pr.png',
    toolChat: 'codex2007-tool-chat.png',
    botStage: 'codex2007-bot-stage.png',
    botStageAnimated: 'codex2007-bot-stage.gif',
    friendStage: 'qq-retro-stage.png',
    friendStageAnimated: 'qq-retro-stage.gif',
    statusIcons: 'codex2007-status-icons.png',
    shield: 'codex2007-shield.png',
    signal: 'codex2007-signal.png',
    flower: 'codex2007-flower.png',
    composerEmoji: 'codex2007-composer-emoji.png',
    composerImage: 'codex2007-composer-image.png',
    composerAttach: 'codex2007-composer-attach.png',
    sendButton: 'codex2007-send.png',
    onlineIcon: 'codex2007-online.png',
    panelTools: 'codex2007-panel-tools.png',
    caret: 'codex2007-caret.png',
    rightControls: 'codex2007-right-controls.png',
    searchIcon: 'codex2007-search.png',
    folderIcon: 'codex2007-folder.png',
    levelStar: 'qq-level-star.png',
    levelMoon: 'qq-level-moon.png',
    levelSun: 'qq-level-sun.png',
    levelCrown: 'qq-level-crown.png',
  };
  const assets = Object.fromEntries(await Promise.all(Object.entries(assetFiles).map(async ([key, file]) => (
    [key, await dataUrl(path.join(assetRoot, file), file.endsWith('.gif') ? 'image/gif' : 'image/png')]
  ))));

  const config = {
    version: VERSION,
    forceEnable: false,
    tokenStats,
    css,
    assets,
  };
  const configLiteral = JSON.stringify(config).replaceAll('<', '\\u003c');
  return `(() => {
    window.__CODEX_2007_CONFIG__ = ${configLiteral};
    return (${runtime});
  })()`;
}

const removeExpression = `(() => {
  localStorage.setItem('codex-2007-disabled', '1');
  const state = window.__CODEX_2007_STATE__;
  if (state && typeof state.cleanup === 'function') state.cleanup({ restoreText: true });
  delete window.__CODEX_2007_CONFIG__;
  return {
    pass: !document.documentElement.classList.contains('codex-2007'),
    disabled: localStorage.getItem('codex-2007-disabled') === '1',
  };
})()`;

const verifyExpression = `(() => {
  const describe = (id) => {
    const element = document.getElementById(id);
    if (!element) return null;
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      id,
      display: style.display,
      visible: rectangle.width > 0 && rectangle.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      rect: {
        x: Math.round(rectangle.x), y: Math.round(rectangle.y),
        width: Math.round(rectangle.width), height: Math.round(rectangle.height),
      },
    };
  };
  const state = window.__CODEX_2007_STATE__;
  const composer = document.querySelector('.composer-surface-chrome');
  const nativeProfileTrigger = document.querySelector('[data-qq2007-native-profile-trigger="true"]');
  const nativeModelTrigger = document.querySelector('[data-qq2007-native-model-trigger="true"]');
  const nativeSendTrigger = document.querySelector('[data-qq2007-native-send-trigger="true"]');
  const root = document.getElementById('root');
  const settingsSurface = Boolean(root && Array.from(root.querySelectorAll('input, textarea, [contenteditable="true"]')).some((node) => /搜索设置|search settings/i.test((node.getAttribute('placeholder') || '') + ' ' + (node.getAttribute('aria-label') || ''))));
  const settingsServiceLabels = ['插件', '浏览器', '电脑操控', '钩子', '连接', 'Git', '环境', '工作树', '已归档任务'];
  const settingsRows = Array.from(root?.querySelectorAll('[data-settings-panel-slug]') || []);
  const settingsRowRects = settingsRows.map((row) => row.getBoundingClientRect());
  const settingsRowsSized = !settingsSurface || Boolean(
    settingsRows.length >= settingsServiceLabels.length
    && settingsRowRects.every((rect) => rect.width >= 120 && rect.height >= 24)
  );
  const settingsRowsHaveIcons = settingsRows.length >= settingsServiceLabels.length
    && settingsRows.every((row) => row.querySelector('svg, img'));
  const settingsMenuIntact = !settingsSurface || (settingsRowsSized && settingsRowsHaveIcons && settingsServiceLabels.every((label) => {
    const row = Array.from(root.querySelectorAll('button, a, [role="button"]')).find((node) => (
      (node.textContent || '').replace(/\s+/g, ' ').trim() === label
      && !node.closest('#qq2007-toolbar, #qq2007-right-panel, #qq2007-statusbar')
    ));
    if (!row || !row.querySelector('svg, img')) return false;
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }));
  const actionable = (element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rectangle.width > 0 && rectangle.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && style.pointerEvents !== 'none';
  };
  const nativeProfileActionReady = actionable(nativeProfileTrigger);
  const nativeModelActionReady = actionable(nativeModelTrigger);
  const nativeSendActionReady = actionable(nativeSendTrigger);
  const approvalDecisions = Array.from(document.querySelectorAll('button')).filter((button) => {
    if (button.closest('[id^="qq2007-"]')) return false;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }).map((button) => (button.textContent || '').replace(/\s+/g, ' ').trim());
  const nativeApprovalActive = approvalDecisions.some((label) => /^(允许一次|允许|approve once|approve|allow once)$/i.test(label))
    && approvalDecisions.some((label) => /^(拒绝|deny|reject|not now)$/i.test(label));
  const nativeActionControlsReady = nativeApprovalActive || (
    nativeProfileActionReady && nativeModelActionReady && nativeSendActionReady
  );
  const sendSkinButton = document.querySelector('.qq2007-send-button');
  const sendVisualHitTarget = (() => {
    if (!(sendSkinButton instanceof HTMLElement)) return false;
    const rect = sendSkinButton.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
    return Boolean(target?.closest?.('[data-qq2007-native-send-trigger="true"]'));
  })();
  const nativeShellIntact = Boolean(
    document.querySelector('aside.app-shell-left-panel')
    && document.querySelector('main.main-surface')
    && composer
    && composer.querySelector('textarea, [contenteditable="true"]')
  );
  const settingsRowsDecorated = settingsRows.length > 0
    && settingsRows.every((row) => row.dataset.qq2007SettingsRow === 'true');
  const settingsThemeApplied = document.documentElement.classList.contains('codex-2007')
    && document.documentElement.dataset.qq2007SettingsSurface === 'true'
    && root?.dataset.qq2007SettingsHost === 'true'
    && settingsRowsDecorated;
  const settingsSidebar = document.querySelector('[data-qq2007-settings-sidebar="true"]');
  const settingsSidebarRect = settingsSidebar?.getBoundingClientRect();
  const settingsNavigation = document.querySelector('[data-qq2007-settings-navigation="true"]');
  const settingsNavigationRect = settingsNavigation?.getBoundingClientRect();
  const settingsVisibleRowCount = settingsNavigationRect ? settingsRows.filter((row) => {
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    return rect.width > 0 && rect.height >= 24
      && style.display !== 'none' && style.visibility !== 'hidden'
      && rect.bottom > settingsNavigationRect.top
      && rect.top < settingsNavigationRect.bottom;
  }).length : 0;
  const settingsNavigationContentReady = !settingsSurface || Boolean(
    settingsNavigation
    && settingsRows.length >= settingsServiceLabels.length
    && settingsRows.every((row) => settingsNavigation.contains(row))
    && settingsVisibleRowCount >= Math.min(3, settingsRows.length)
  );
  const settingsSidebarFillsPane = !settingsSurface || Boolean(
    settingsSidebar?.matches('aside.app-shell-left-panel')
    && settingsSidebarRect
    && settingsSidebarRect.height >= innerHeight * 0.75
    && settingsSidebarRect.bottom >= innerHeight - 2
  );
  const settingsNavigationFillsPane = !settingsSurface || Boolean(
    settingsNavigationRect
    && settingsSidebarRect
    && settingsNavigationRect.height >= Math.max(120, settingsSidebarRect.height * 0.45)
    && settingsNavigationRect.bottom >= settingsSidebarRect.bottom - 18
  );
  const settingsChromeReady = !settingsSurface || Boolean(
    document.querySelector('#qq2007-settings-title')
    && document.querySelector('[data-qq2007-settings-topbar="true"]')
    && document.querySelector('[data-qq2007-settings-sidebar="true"]')
    && document.querySelector('[data-qq2007-settings-main="true"]')
    && settingsSidebarFillsPane
    && settingsNavigationFillsPane
    && settingsRowsSized
    && settingsNavigationContentReady
  );
  const nativeAppIntact = settingsSurface ? (settingsMenuIntact && settingsThemeApplied && settingsChromeReady) : nativeShellIntact;
  const nodes = {
    titlebar: describe('qq2007-window-title'),
    toolbar: describe('qq2007-toolbar'),
    leftHeader: describe('qq2007-left-header'),
    leftProfile: describe('qq2007-left-profile'),
    leftUser: describe('qq2007-left-user'),
    mainTitle: describe('qq2007-main-title'),
    composerChrome: describe('qq2007-composer-chrome'),
    rightPanel: describe('qq2007-right-panel'),
    statusbar: describe('qq2007-statusbar'),
    toast: describe('qq2007-toast'),
    homeWelcome: describe('qq2007-home-welcome'),
  };
  const reducedMotionActive = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const rightStageImages = Array.from(document.querySelectorAll('#qq2007-right-panel [data-qq2007-motion-stage]'));
  const visibleRightStageImages = rightStageImages.filter((image) => getComputedStyle(image).display !== 'none');
  const expectedStageMime = reducedMotionActive ? 'data:image/png;base64,' : 'data:image/gif;base64,';
  const expectedStageKind = reducedMotionActive ? 'static' : 'animated';
  const animatedStagesReady = settingsSurface || Boolean(
    rightStageImages.length === 4
    && visibleRightStageImages.length === 2
    && visibleRightStageImages.every((image) => (
      (image.currentSrc || image.src || '').startsWith(expectedStageMime)
      && image.dataset.qq2007MotionStage === expectedStageKind
    ))
  );
  const toolbarActions = Array.from(document.querySelectorAll('#qq2007-toolbar [data-native-action]'));
  const titleText = document.querySelector('[data-qq-session-title]')?.textContent?.trim() || '';
  const shellTopbar = document.querySelector('[data-qq2007-topbar-host="true"]')
    || document.querySelector('#qq2007-window-title')?.parentElement;
  const nativeMenuButtonsVisible = shellTopbar
    ? Array.from(shellTopbar.querySelectorAll('button')).filter((button) => !button.closest('#qq2007-window-title')).some((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    })
    : true;
  const wideEnoughForRightPanel = innerWidth > 1080;
  const isViewportVisible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0
      && rect.left < innerWidth && rect.top < innerHeight
      && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const isNativeTrayExpanded = (card) => {
    const motionShell = card.closest('.origin-top-right');
    if (!motionShell) return false;
    const transform = getComputedStyle(motionShell).transform;
    if (!transform || transform === 'none') return true;
    try {
      const matrix = new DOMMatrixReadOnly(transform);
      return Math.abs(matrix.m41) <= 2
        && Math.abs(matrix.m42) <= 2
        && matrix.a >= 0.98
        && matrix.d >= 0.98;
    } catch {
      return false;
    }
  };
  const nativeOutputOverlayActive = Array.from(document.querySelectorAll('main.main-surface div')).some((node) => {
    const rect = node.getBoundingClientRect();
    const visibleTrayCards = Array.from(node.querySelectorAll('.bg-token-dropdown-background')).filter((card) => (
      card.getBoundingClientRect().width >= 200
      && isViewportVisible(card)
      && isNativeTrayExpanded(card)
    ));
    const isNativeInformationTray = visibleTrayCards.some((card) => {
      const cardText = (card.textContent || '').replace(/\s+/g, ' ').trim();
      return /(?:输出|output|来源|source|环境信息|environment(?:\s+information)?)/i.test(cardText);
    });
    return node.classList.contains('absolute')
      && node.classList.contains('right-0')
      && rect.width >= 220 && rect.height > 0
      && isViewportVisible(node)
      && isNativeInformationTray;
  });
  const nativeNavGlyphsHidden = Array.from(document.querySelectorAll('[data-qq2007-native-nav-glyph="true"]')).every((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
  });
  const homeSurfaceDetected = Boolean(document.querySelector('[data-qq2007-home-suggestions="true"]'));
  const homeWelcomeReady = !homeSurfaceDetected || Boolean(
    nodes.homeWelcome?.visible
    && document.querySelector('#qq2007-home-welcome .qq2007-home-welcome-bot')
    && document.querySelector('#qq2007-home-welcome .qq2007-home-welcome-status')
    && document.querySelectorAll('[data-qq2007-home-card="true"] .qq2007-home-card-badge').length >= 3
    && document.querySelectorAll('[data-qq2007-home-card="true"] .qq2007-home-card-copy').length >= 3
  );
  const levelIcons = Array.from(document.querySelectorAll('[data-qq-level-icons] img'));
  const authenticLevelIconsReady = !state?.qqLevel || (levelIcons.length > 0 && levelIcons.every((icon) => /^(star|moon|sun|crown)$/.test(icon.dataset.qqLevelAsset || '') && (icon.getAttribute('src') || '').startsWith('data:image/png;base64,')));
  const mainSurfaceRect = document.querySelector('main.main-surface')?.getBoundingClientRect();
  const mainTitleIconRect = document.querySelector('#qq2007-main-title img')?.getBoundingClientRect();
  const mainTitleClearOfLeftRail = settingsSurface || Boolean(
    mainSurfaceRect
    && mainTitleIconRect
    && mainTitleIconRect.left >= mainSurfaceRect.left + 6
  );
  const nativeMessageActions = Array.from(document.querySelectorAll('main.main-surface button[aria-label]')).filter((button) => (
    /^(?:复制|复制消息|copy|copy message|喜欢|不喜欢|like|dislike|从这里继续新任务|continue(?: from here)?(?: in a)? new task|fork|share|分享)$/i.test((button.getAttribute('aria-label') || '').trim())
  ));
  const classicMessageActionsReady = nativeMessageActions.length === 0 || nativeMessageActions.every((button) => Boolean(
    button.dataset.qq2007MessageAction
    && button.querySelector(':scope > .qq2007-message-action-icon')
    && button.querySelector(':scope > .qq2007-message-action-label')
    && button.querySelector('[data-qq2007-message-native-icon="true"]')
  ));
  const decoratedMessageActionStrips = Array.from(document.querySelectorAll('[data-qq2007-message-actions="true"]'));
  const classicMessageActionStripsScoped = decoratedMessageActionStrips.every((strip) => {
    const actions = Array.from(strip.querySelectorAll('button[data-qq2007-message-action]'));
    const kinds = new Set(actions.map((button) => button.dataset.qq2007MessageAction));
    return actions.length === 4
      && kinds.size === 4
      && ['copy', 'like', 'dislike', 'share'].every((kind) => kinds.has(kind));
  });
  const threadScroller = document.querySelector('.thread-scroll-container');
  const conversation = threadScroller?.querySelector('[data-thread-find-target="conversation"]');
  const threadRect = threadScroller?.getBoundingClientRect();
  const conversationRect = conversation?.getBoundingClientRect();
  const visibleTurns = threadRect ? Array.from(threadScroller.querySelectorAll('[data-turn-key]')).filter((turn) => {
    const rectangle = turn.getBoundingClientRect();
    return rectangle.width > 0
      && rectangle.height > 0
      && rectangle.bottom > threadRect.top
      && rectangle.top < threadRect.bottom;
  }) : [];
  const conversationTurnsContained = !threadRect || !conversationRect || visibleTurns.every((turn) => {
    const rectangle = turn.getBoundingClientRect();
    return rectangle.left >= conversationRect.left - 2
      && rectangle.right <= conversationRect.right + 2
      && rectangle.width <= conversationRect.width + 4;
  });
  const pass = Boolean(
    state
    && (settingsSurface ? (settingsMenuIntact && settingsThemeApplied && settingsChromeReady) : (
      document.documentElement.classList.contains('codex-2007')
    && state
    && nodes.titlebar?.visible
    && nodes.toolbar?.visible
    && nodes.leftHeader?.visible
    && nodes.leftProfile?.visible
    && nodes.leftUser?.visible
    && nodes.mainTitle?.visible
    && nodes.composerChrome?.visible
    && nodes.statusbar?.visible
    && (!wideEnoughForRightPanel || nativeOutputOverlayActive || nodes.rightPanel?.visible)
    && nodes.titlebar.rect.height >= 40
    && nodes.titlebar.rect.height <= 42
    && nodes.toolbar.rect.height === 54
    && nodes.statusbar.rect.height === 32
    && toolbarActions.length === 6
    && /^Codex 2007\\s*-\\s*.+/.test(titleText)
    && !nativeMenuButtonsVisible
    && nativeNavGlyphsHidden
    && nativeActionControlsReady
    && sendVisualHitTarget
    && homeWelcomeReady
    && document.documentElement.scrollWidth <= innerWidth + 2
    && nativeAppIntact
    && authenticLevelIconsReady
    && animatedStagesReady
    && classicMessageActionsReady
    && classicMessageActionStripsScoped
    && conversationTurnsContained
    && mainTitleClearOfLeftRail
    ))
  );
  return {
    pass,
    version: state?.version ?? null,
    location: location.href,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    disabled: localStorage.getItem('codex-2007-disabled') === '1',
    classApplied: document.documentElement.classList.contains('codex-2007'),
    agentState: state?.lastAgentState ?? null,
    tokenStats: state?.tokenStats ? {
      available: Boolean(state.tokenStats.available),
      totalTokens: state.tokenStats.totalTokens ?? null,
      sessionCount: state.tokenStats.sessionCount ?? 0,
      source: state.tokenStats.source ?? null,
    } : null,
    qqLevel: state?.qqLevel ? {
      level: state.qqLevel.level,
      progress: state.qqLevel.progress,
      totalTokens: state.qqLevel.totalTokens,
    } : null,
    renamedTextNodes: state?.textRenames?.size ?? 0,
    renamedAttributes: state?.attributeRenames?.size ?? 0,
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    visualContract: {
      visualVersion: 'Codex 2007',
      titleText,
      toolbarActionCount: toolbarActions.length,
      nativeMenuButtonsVisible,
      nativeApprovalActive,
      nativeActionControlsReady,
      nativeNavGlyphsHidden,
      nativeProfileActionReady,
      nativeModelActionReady,
      nativeSendActionReady,
      sendVisualHitTarget,
      homeSurfaceDetected,
      homeWelcomeReady,
      nativeOutputOverlayActive,
      settingsSurface,
      settingsMenuIntact,
      settingsThemeApplied,
      settingsRowsDecorated,
      settingsChromeReady,
      settingsSidebarFillsPane,
      settingsNavigationFillsPane,
      settingsNavigationContentReady,
      settingsRowsSized,
      settingsRowCount: settingsRows.length,
      settingsVisibleRowCount,
      settingsSidebarRect: settingsSidebarRect ? {
        x: Math.round(settingsSidebarRect.x),
        y: Math.round(settingsSidebarRect.y),
        width: Math.round(settingsSidebarRect.width),
        height: Math.round(settingsSidebarRect.height),
        bottom: Math.round(settingsSidebarRect.bottom),
      } : null,
      settingsNavigationRect: settingsNavigationRect ? {
        x: Math.round(settingsNavigationRect.x),
        y: Math.round(settingsNavigationRect.y),
        width: Math.round(settingsNavigationRect.width),
        height: Math.round(settingsNavigationRect.height),
        bottom: Math.round(settingsNavigationRect.bottom),
      } : null,
      settingsServiceRowCount: settingsRows.length,
      settingsServiceIconsReady: settingsRowsHaveIcons,
      authenticLevelIconsReady,
      levelIconCount: levelIcons.length,
      reducedMotionActive,
      animatedStagesReady,
      animatedStageCount: visibleRightStageImages.length,
      classicMessageActionsReady,
      classicMessageActionCount: nativeMessageActions.length,
      classicMessageActionStripsScoped,
      decoratedMessageActionStripCount: decoratedMessageActionStrips.length,
      conversationTurnsContained,
      visibleConversationTurnCount: visibleTurns.length,
      mainTitleClearOfLeftRail,
      mainTitleIconLeft: mainTitleIconRect ? Math.round(mainTitleIconRect.left) : null,
      mainSurfaceLeft: mainSurfaceRect ? Math.round(mainSurfaceRect.left) : null,
    },
    nodes,
    nativeAppIntact,
  };
})()`;

const inspectExpression = `(() => {
  const describe = (element) => {
    if (!element) return null;
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList).slice(0, 16),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      rect: {
        x: Math.round(rectangle.x), y: Math.round(rectangle.y),
        width: Math.round(rectangle.width), height: Math.round(rectangle.height),
      },
      display: style.display,
      position: style.position,
    };
  };
  const root = document.getElementById('root');
  const shell = root?.firstElementChild || null;
  const tree = (element, depth = 0) => {
    if (!element || depth > 3) return null;
    return {
      ...describe(element),
      children: Array.from(element.children).slice(0, 24).map((child) => tree(child, depth + 1)),
    };
  };
  return {
    location: location.href,
    readyState: document.readyState,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    selectors: {
      root: document.querySelectorAll('#root').length,
      leftPanel: document.querySelectorAll('aside.app-shell-left-panel').length,
      mainSurface: document.querySelectorAll('main.main-surface').length,
      composer: document.querySelectorAll('.composer-surface-chrome').length,
      topBars: document.querySelectorAll('.app-header-tint').length,
    },
    root: describe(root),
    shell: describe(shell),
    shellTree: tree(shell),
  };
})()`;

async function connect(port) {
  const target = await discoverTarget(port);
  const session = await new CdpSession(target.verifiedWebSocketUrl).open();
  return { target, session };
}

async function applyUntilReady(session, bootstrap, timeoutMs = 60000, { preserveExistingSettings = false } = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastApplied = null;
  let lastVerified = null;
  let reapplyBootstrap = true;
  if (preserveExistingSettings) {
    lastVerified = await session.evaluate(verifyExpression);
    if (lastVerified?.visualContract?.settingsSurface && lastVerified?.version) {
      lastApplied = { pass: true, preservedSettingsSurface: true };
      reapplyBootstrap = false;
    }
  }
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    if (reapplyBootstrap) lastApplied = await session.evaluate(bootstrap);
    lastVerified = await session.evaluate(verifyExpression);
    if (lastApplied?.pass && lastVerified?.pass && lastVerified?.nativeAppIntact) {
      return {
        ...lastApplied,
        attempts,
        readyAfterMs: Date.now() - startedAt,
      };
    }
    // Settings is an in-app surface whose rows hydrate progressively. Re-running
    // the complete bootstrap there can tear down React state and return to the
    // previous task, so keep the suspended theme stable while verification waits.
    reapplyBootstrap = !lastVerified?.visualContract?.settingsSurface;
    await delay(250);
  }
  throw new Error(`Codex native shell did not become theme-ready within ${timeoutMs}ms: ${JSON.stringify({
    applied: lastApplied,
    verified: lastVerified,
  })}`);
}

async function enableAndApply(session, bootstrap, enable) {
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap });
  if (enable) {
    await session.evaluate(`localStorage.removeItem('codex-2007-disabled'); true`);
  }
  return applyUntilReady(session, bootstrap);
}

async function writeJson(outputPath, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

async function screenshot(session, outputPath) {
  const result = await session.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  }, 30000);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(result.data, 'base64'));
  return { pass: true, output: outputPath };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function watch(options, bootstrap) {
  let stopped = false;
  let active = null;
  let firstEnablePending = options.enable;
  let lastError = null;
  let nextTokenRefresh = Date.now() + 60000;

  const stop = () => {
    stopped = true;
    active?.session.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    try {
      const target = await discoverTarget(options.port);
      const targetChanged = !active
        || active.target.id !== target.id
        || active.session.closed;
      if (targetChanged) {
        active?.session.close();
        const session = await new CdpSession(target.verifiedWebSocketUrl).open();
        const applied = await enableAndApply(session, bootstrap, firstEnablePending);
        firstEnablePending = false;
        active = { target, session };
        lastError = null;
        const ready = {
          pass: true,
          mode: 'watch',
          pid: process.pid,
          port: options.port,
          targetId: target.id,
          applied,
          startedAt: new Date().toISOString(),
        };
        if (options.readyFile) await writeJson(options.readyFile, ready);
        else await writeJson(null, ready);
      } else {
        const verified = await active.session.evaluate(verifyExpression);
        if ((!verified?.pass || !verified?.nativeAppIntact) && !verified?.visualContract?.nativeApprovalActive) {
          if (verified?.visualContract?.settingsSurface && verified?.version) {
            // Never run the full bootstrap over a live settings surface. React
            // may still be hydrating its category list, and teardown here can
            // erase the menu or navigate back to the previous task.
            await active.session.evaluate(`(() => {
              const state = window.__CODEX_2007_STATE__;
              return state && typeof state.refreshSettingsTheme === 'function'
                ? state.refreshSettingsTheme()
                : false;
            })()`);
          } else {
            await applyUntilReady(active.session, bootstrap);
          }
        }
      }
      if (active && Date.now() >= nextTokenRefresh) {
        const tokenStats = await collectTokenStats();
        const tokenStatsLiteral = JSON.stringify(tokenStats).replaceAll('<', '\\u003c');
        await active.session.evaluate(`(() => {
          const state = window.__CODEX_2007_STATE__;
          return state && typeof state.updateTokenStats === 'function'
            ? state.updateTokenStats(${tokenStatsLiteral})
            : false;
        })()`);
        nextTokenRefresh = Date.now() + 60000;
      }
    } catch (error) {
      active?.session.close();
      active = null;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) {
        process.stderr.write(`[codex-2007-watch] ${message}\n`);
        lastError = message;
      }
    }
    if (!stopped) await delay(options.interval);
  }

  if (options.readyFile) {
    try {
      await fs.unlink(options.readyFile);
    } catch {
      // The ready file may already have been removed by the restore script.
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const needsBootstrap = options.command === 'apply' || options.command === 'watch';
  const tokenStats = needsBootstrap ? await collectTokenStats() : null;
  const bootstrap = needsBootstrap ? await buildBootstrap(options.assetRoot, tokenStats) : null;

  if (options.command === 'watch') {
    await watch(options, bootstrap);
    return;
  }

  const { target, session } = await connect(options.port);
  try {
    if (options.command === 'apply') {
      const applied = await enableAndApply(session, bootstrap, options.enable);
      const verified = await session.evaluate(verifyExpression);
      await writeJson(options.output, {
        pass: Boolean(applied?.pass && verified?.pass),
        command: 'apply',
        targetId: target.id,
        applied,
        verified,
      });
      if (!applied?.pass || !verified?.pass) process.exitCode = 2;
      return;
    }
    if (options.command === 'remove') {
      const removed = await session.evaluate(removeExpression);
      await writeJson(options.output, { command: 'remove', targetId: target.id, ...removed });
      if (!removed?.pass) process.exitCode = 2;
      return;
    }
    if (options.command === 'verify') {
      const verified = await session.evaluate(verifyExpression);
      await writeJson(options.output, { command: 'verify', targetId: target.id, ...verified });
      if (!verified?.pass) process.exitCode = 2;
      return;
    }
    if (options.command === 'inspect') {
      const inspected = await session.evaluate(inspectExpression);
      await writeJson(options.output, { command: 'inspect', targetId: target.id, ...inspected });
      return;
    }
    if (options.command === 'screenshot') {
      await writeJson(null, await screenshot(session, options.output));
    }
  } finally {
    session.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
