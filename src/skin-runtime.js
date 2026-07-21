(() => {
  'use strict';

  const STATE_KEY = '__QQ2009_PROGRAMMER_CODEX_STATE__';
  const CONFIG_KEY = '__QQ2009_PROGRAMMER_CODEX_CONFIG__';
  const DISABLED_KEY = 'qq2009-programmer-codex-disabled';
  const WEEKLY_QUOTA_KEY = 'qq2009-programmer-codex-weekly-quota';
  const STYLE_ID = 'qq2009-programmer-codex-style';
  const config = window[CONFIG_KEY];

  if (!config || typeof config.css !== 'string' || !config.assets) {
    return { pass: false, reason: 'missing-config' };
  }
  if (config.forceEnable) localStorage.removeItem(DISABLED_KEY);
  else if (localStorage.getItem(DISABLED_KEY) === '1') return { pass: false, reason: 'disabled-by-user' };

  if (window[STATE_KEY] && typeof window[STATE_KEY].cleanup === 'function') {
    window[STATE_KEY].cleanup({ restoreText: true });
  }

  const state = {
    version: config.version || '1.0.0',
    observer: null,
    timers: new Set(),
    textRenames: new Map(),
    attributeRenames: new Map(),
    lastAgentState: null,
    reconcileQueued: false,
    toastTimer: null,
    tokenStats: config.tokenStats || null,
    qqLevel: null,
    nativeSendButton: null,
    nativeModelButton: null,
    nativeAttachButton: null,
    nativeSearchButton: null,
    nativeProfileButton: null,
    weeklyQuota: null,
    settingsPaused: false,
  };
  window[STATE_KEY] = state;

  const byId = (id) => document.getElementById(id);
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  };
  const makeImage = (source, alt, className) => {
    const image = create('img', className || '');
    image.src = source;
    image.alt = alt;
    image.draggable = false;
    return image;
  };
  const makeSettingsTitle = () => {
    const title = create('div', 'qq2007-settings-title');
    title.id = 'qq2007-settings-title';
    title.setAttribute('aria-hidden', 'true');
    title.appendChild(makeImage(config.assets.penguin2007, '', 'qq2007-settings-title-icon'));
    title.appendChild(create('span', '', 'Codex 2007 - 设置'));
    return title;
  };
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rectangle.width > 0 && rectangle.height > 0
      && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const isSettingsSurface = () => {
    const root = document.getElementById('root');
    if (!root) return false;
    const hasSettingsSearch = Array.from(root.querySelectorAll('input, textarea, [contenteditable="true"]')).some((node) => /搜索设置|search settings/i.test(`${node.getAttribute('placeholder') || ''} ${node.getAttribute('aria-label') || ''}`));
    const hasBackToApp = Array.from(root.querySelectorAll('button, a, [role="button"], [role="link"]')).some((node) => /^(返回应用|back to app)$/i.test(normalize(node.textContent)));
    return hasSettingsSearch && hasBackToApp;
  };
  const loadWeeklyQuota = () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(WEEKLY_QUOTA_KEY) || 'null');
      if (!cached || cached.period !== '1周' || !Number.isFinite(cached.percentage)) return null;
      if (!Number.isFinite(cached.capturedAt) || Date.now() - cached.capturedAt > 6 * 60 * 60 * 1000) return null;
      return { period: '1周', percentage: Math.max(0, Math.min(100, Math.round(cached.percentage))) };
    } catch {
      return null;
    }
  };
  const persistWeeklyQuota = (quota) => {
    try {
      sessionStorage.setItem(WEEKLY_QUOTA_KEY, JSON.stringify({ ...quota, capturedAt: Date.now() }));
    } catch {
      // The live display still works if session storage is unavailable.
    }
  };
  state.weeklyQuota = loadWeeklyQuota();
  const setTimer = (callback, delay) => {
    const timer = window.setTimeout(() => {
      state.timers.delete(timer);
      callback();
    }, delay);
    state.timers.add(timer);
    return timer;
  };
  const clearManagedTimers = () => {
    for (const timer of state.timers) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    state.timers.clear();
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = null;
  };

  const findButton = ({ aria = [], text = [], within = document }) => {
    const buttons = Array.from(within.querySelectorAll('button, [role="button"]'));
    return buttons.find((button) => {
      if (button.closest('[id^="qq2007-"]')) return false;
      if (!isVisible(button)) return false;
      const ariaLabel = normalize(button.getAttribute('aria-label'));
      const buttonText = normalize(button.textContent);
      return aria.some((pattern) => pattern.test(ariaLabel))
        || text.some((pattern) => pattern.test(buttonText));
    }) || null;
  };

  const nativeActions = {
    newTask: () => findButton({
      aria: [/新建任务/i, /new task/i, /new chat/i],
      text: [/^新建任务$/i, /^new task$/i],
    }),
    scheduled: () => findButton({
      aria: [/已安排/i, /scheduled/i],
      text: [/^已安排$/i, /^scheduled$/i],
    }),
    plugins: () => findButton({
      aria: [/插件/i, /plugins?/i],
      text: [/^插件$/i, /^plugins?$/i],
    }),
    sites: () => findButton({
      aria: [/站点/i, /sites?/i],
      text: [/^站点$/i, /^sites?$/i],
    }),
    pullRequests: () => findButton({
      aria: [/拉取请求/i, /pull requests?/i],
      text: [/^拉取请求$/i, /^pull requests?$/i],
    }),
    projects: () => findButton({
      aria: [/项目侧边栏选项/i, /添加新项目/i, /projects?/i],
      text: [/^项目$/i, /^projects?$/i],
    }),
    search: () => (state.nativeSearchButton?.isConnected ? state.nativeSearchButton : findButton({
      aria: [/^搜索$/i, /^搜索好友$/i, /^search$/i],
    })),
    profile: () => (state.nativeProfileButton?.isConnected ? state.nativeProfileButton : findButton({
      aria: [/个人资料/i, /profile/i, /账户/i, /account/i],
    })),
    commit: () => findButton({
      aria: [/commit/i, /提交/i, /^发送消息$/i],
      text: [/^commit$/i, /^提交$/i, /^发送消息$/i],
    }),
  };

  const focusComposer = () => {
    const input = document.querySelector(
      '.composer-surface-chrome textarea, .composer-surface-chrome [contenteditable="true"], textarea, [contenteditable="true"]',
    );
    if (!(input instanceof HTMLElement)) return false;
    input.focus();
    return true;
  };
  const invoke = (action, fallback) => {
    const target = typeof action === 'function' ? action() : null;
    if (target instanceof HTMLElement) {
      target.click();
      return true;
    }
    return typeof fallback === 'function' ? Boolean(fallback()) : false;
  };

  const setAssetVariables = () => {
    const style = document.documentElement.style;
    style.setProperty('--qq2007-title-bg', `url("${config.assets.titleBg}")`);
    style.setProperty('--qq2007-toolbar-bg', `url("${config.assets.toolbarBg}")`);
    style.setProperty('--qq2007-panel-header-bg', `url("${config.assets.panelHeaderBg}")`);
    style.setProperty('--qq2007-status-bg', `url("${config.assets.statusBg}")`);
    style.setProperty('--qq2007-send-bg', `url("${config.assets.sendButton}")`);
    style.setProperty('--qq2007-folder-bg', `url("${config.assets.folderIcon}")`);
  };
  const installStyle = () => {
    byId(STYLE_ID)?.remove();
    const style = create('style');
    style.id = STYLE_ID;
    style.textContent = config.css;
    (document.head || document.documentElement).appendChild(style);
  };

  const readSessionTitle = () => {
    const main = document.querySelector('main.main-surface');
    const selectors = [
      'header h1', 'header h2', 'header [data-slot="title"]',
      '[aria-current="page"]', '[data-active="true"]',
    ];
    for (const selector of selectors) {
      const nodes = Array.from((selector.startsWith('header') ? main : document)?.querySelectorAll?.(selector) || []);
      for (const node of nodes) {
        if (node.closest('[id^="qq2007-"]')) continue;
        const text = normalize(node.textContent);
        if (text && text.length >= 2 && text.length <= 80 && !/^(Codex|我的好友)$/i.test(text)) return text;
      }
    }
    const documentTitle = normalize(document.title).replace(/\s*[-–—]\s*Codex.*$/i, '');
    return documentTitle && !/^Codex$/i.test(documentTitle) ? documentTitle : '新建任务';
  };

  const makeWindowTitle = () => {
    const title = create('div');
    title.id = 'qq2007-window-title';
    const identity = create('div', 'qq2007-title-identity');
    identity.appendChild(makeImage(config.assets.penguin2007, 'Codex企鹅'));
    const text = create('span', '', 'Codex 2007 - 新建任务');
    text.dataset.qqSessionTitle = 'true';
    identity.appendChild(text);
    const controls = makeImage(config.assets.windowControls, '窗口控制按钮', 'qq2007-window-controls');
    title.append(identity, controls);
    return title;
  };

  const addToolButton = (container, definition) => {
    const button = create('button', 'qq2007-tool-button');
    button.type = 'button';
    button.title = definition.title;
    button.setAttribute('aria-label', definition.title);
    button.dataset.nativeAction = definition.key;
    button.appendChild(makeImage(config.assets[definition.asset], ''));
    button.appendChild(create('span', '', definition.label));
    button.addEventListener('click', () => invoke(definition.action, definition.fallback));
    container.appendChild(button);
    return button;
  };

  const makeToolbar = () => {
    const toolbar = create('nav');
    toolbar.id = 'qq2007-toolbar';
    toolbar.setAttribute('aria-label', 'Codex 2007 功能工具栏');
    const actions = [
      { key: 'new-task', label: '新建任务', title: '新建任务', asset: 'toolNew', action: nativeActions.newTask, fallback: focusComposer },
      { key: 'scheduled', label: '已安排', title: '打开已安排任务', asset: 'toolScheduled', action: nativeActions.scheduled },
      { key: 'plugins', label: '插件', title: '打开插件', asset: 'toolPlugins', action: nativeActions.plugins },
      { key: 'sites', label: '站点', title: '打开站点', asset: 'toolSites', action: nativeActions.sites },
      { key: 'pull-requests', label: '拉取请求', title: '打开拉取请求', asset: 'toolPullRequests', action: nativeActions.pullRequests },
      { key: 'chat', label: '聊天', title: '聚焦当前聊天输入框', asset: 'toolChat', action: null, fallback: focusComposer },
    ];
    for (const definition of actions) addToolButton(toolbar, definition);
    return toolbar;
  };

  const makeLeftHeader = () => {
    const header = create('button', 'qq2007-left-header');
    header.id = 'qq2007-left-header';
    header.type = 'button';
    header.title = 'Codex 用户资料';
    header.appendChild(makeImage(config.assets.penguin2007, 'Codex企鹅'));
    header.appendChild(create('strong', '', 'Codex'));
    header.appendChild(makeImage(config.assets.caret, '', 'qq2007-left-caret'));
    header.addEventListener('click', () => invoke(nativeActions.profile));
    return header;
  };

  const makeLeftProfile = () => {
    const profile = create('div');
    profile.id = 'qq2007-left-profile';
    const user = create('button', 'qq2007-left-user');
    user.id = 'qq2007-left-user';
    user.type = 'button';
    user.title = '打开 Codex 个人资料';
    user.appendChild(makeImage(config.assets.penguin2007, 'Codex企鹅'));
    const copy = create('span', 'qq2007-left-user-copy');
    copy.appendChild(create('strong', '', 'Codex 程序员'));
    const meta = create('span', 'qq2007-left-user-meta');
    const statusIcon = makeImage(config.assets.onlineIcon, '', 'qq2007-status-icon');
    statusIcon.dataset.qqAgentDot = 'left';
    const status = create('span', '', '在线');
    status.dataset.qqAgentStatus = 'left';
    const balance = create('span', '', 'Q币余额 --');
    balance.dataset.qqCoinBalance = 'left';
    meta.append(statusIcon, status, balance);
    copy.appendChild(meta);
    user.appendChild(copy);
    user.addEventListener('click', () => invoke(nativeActions.profile));

    const search = create('button', 'qq2007-left-search');
    search.type = 'button';
    search.title = '搜索任务与项目';
    search.appendChild(makeImage(config.assets.searchIcon, ''));
    search.appendChild(create('span', '', '搜索...'));
    search.addEventListener('click', () => invoke(nativeActions.search));
    profile.append(user, search);
    return profile;
  };

  const makeMainTitle = () => {
    const title = create('div', 'qq2007-main-title');
    title.id = 'qq2007-main-title';
    title.appendChild(makeImage(config.assets.toolNew, ''));
    const text = create('strong', '', '新建任务');
    text.dataset.qqMainTitle = 'true';
    title.appendChild(text);
    return title;
  };

  const makeHomeWelcome = () => {
    const welcome = create('section', 'qq2007-home-welcome');
    welcome.id = 'qq2007-home-welcome';
    welcome.setAttribute('aria-label', 'Codex 2007 新建任务欢迎区');
    const header = create('div', 'qq2007-home-welcome-header');
    header.appendChild(makeImage(config.assets.penguin2007, 'Codex 企鹅'));
    header.appendChild(create('strong', '', 'Codex 小蓝在线'));
    const body = create('div', 'qq2007-home-welcome-body');
    body.appendChild(create('strong', '', '今天想和我一起完成什么？'));
    body.appendChild(create('span', '', '选择下方任务类型，或直接在输入框里告诉我。'));
    welcome.append(header, body);
    return welcome;
  };

  const decorateHomeSurface = () => {
    const main = document.querySelector('main.main-surface');
    if (!main) return;
    for (const node of main.querySelectorAll('[data-qq2007-home-suggestions], [data-qq2007-home-prompt], [data-qq2007-home-card]')) {
      delete node.dataset.qq2007HomeSuggestions;
      delete node.dataset.qq2007HomePrompt;
      delete node.dataset.qq2007HomeCard;
    }
    const homeCardPattern = /探索并理解代码|构建新功能|审查代码|修复问题/;
    const exactCandidates = [
      ...main.querySelectorAll('section[class*="home-suggestions"], [class*="home-suggestions"]'),
      ...main.querySelectorAll('section'),
    ];
    let suggestions = exactCandidates.find((node) => {
      if (node.closest('[id^="qq2007-"]')) return false;
      const text = normalize(node.textContent);
      return /探索并理解代码/.test(text)
        && /构建新功能/.test(text)
        && /审查代码/.test(text)
        && /修复问题/.test(text)
        && node.querySelectorAll('button').length >= 4
        && node.querySelectorAll('button').length <= 5;
    });
    // At narrower desktop widths Codex renders only three suggestion cards.
    // Match the real card buttons rather than assuming the four-card layout.
    if (!suggestions) {
      const cards = Array.from(main.querySelectorAll('button')).filter((button) => {
        if (button.closest('[id^="qq2007-"]') || !isVisible(button)) return false;
        return homeCardPattern.test(normalize(button.textContent));
      });
      if (cards.length >= 3 && cards.length <= 4) {
        let commonAncestor = cards[0].parentElement;
        while (commonAncestor && commonAncestor !== main && !cards.every((card) => commonAncestor.contains(card))) {
          commonAncestor = commonAncestor.parentElement;
        }
        if (commonAncestor instanceof HTMLElement && commonAncestor !== main) suggestions = commonAncestor;
      }
    }
    if (!suggestions) {
      byId('qq2007-home-welcome')?.remove();
      for (const node of main.querySelectorAll('[data-qq2007-home-suggestions], [data-qq2007-home-prompt], [data-qq2007-home-card]')) {
        delete node.dataset.qq2007HomeSuggestions;
        delete node.dataset.qq2007HomePrompt;
        delete node.dataset.qq2007HomeCard;
      }
      return;
    }
    suggestions.dataset.qq2007HomeSuggestions = 'true';
    const anchor = suggestions.parentElement?.parentElement || suggestions.parentElement;
    if (anchor instanceof HTMLElement) {
      const prompt = Array.from(anchor.querySelectorAll('div')).find((node) => (
        node !== anchor && normalize(node.textContent) === '我们该构建什么？'
      ));
      if (prompt) prompt.dataset.qq2007HomePrompt = 'true';
      let welcome = byId('qq2007-home-welcome');
      if (welcome && welcome.parentElement !== anchor) {
        welcome.remove();
        welcome = null;
      }
      if (!welcome) {
        welcome = makeHomeWelcome();
        anchor.appendChild(welcome);
      }
    }
    for (const card of suggestions.querySelectorAll(':scope button')) card.dataset.qq2007HomeCard = 'true';
  };

  const decorateMessageContent = () => {
    const main = document.querySelector('main.main-surface');
    if (!main) return;
    for (const block of main.querySelectorAll('pre')) {
      if (block.closest('[id^="qq2007-"]')) continue;
      const code = block.querySelector('code');
      const className = `${code?.className || ''} ${block.className || ''}`;
      const language = className.match(/(?:language-|lang-)([a-z0-9_+-]+)/i)?.[1]
        || normalize(code?.getAttribute('data-language'))
        || 'bash';
      block.dataset.qq2007CodeLanguage = language;
    }
  };

  const findComposer = () => document.querySelector('.composer-surface-chrome');
  const detectComposerControls = () => {
    const composer = findComposer();
    if (!composer) return;
    const buttons = Array.from(composer.querySelectorAll('button')).filter((button) => !button.closest('[id^="qq2007-"]'));
    const previousSendButton = state.nativeSendButton;
    const explicitSendButton = buttons.find((button) => {
      const label = `${normalize(button.getAttribute('aria-label'))} ${normalize(button.title)} ${normalize(button.textContent)}`;
      return /发送|send|submit/i.test(label);
    });
    const primaryComposerButton = buttons.find((button) => /size-token-button-composer/.test(String(button.className)));
    state.nativeSendButton = explicitSendButton
      || primaryComposerButton
      || (state.nativeSendButton?.isConnected ? state.nativeSendButton : null);
    if (previousSendButton && previousSendButton !== state.nativeSendButton) {
      delete previousSendButton.dataset.qq2007NativeSendTrigger;
    }
    if (state.nativeSendButton) state.nativeSendButton.dataset.qq2007NativeSendTrigger = 'true';
    state.nativeAttachButton = buttons.find((button) => {
      const label = `${normalize(button.getAttribute('aria-label'))} ${normalize(button.title)} ${normalize(button.textContent)}`;
      return /附件|附加|attach|add context|添加/i.test(label);
    }) || state.nativeAttachButton;
    const previousModelButton = state.nativeModelButton;
    const modelButton = buttons.find((button) => (
      button.getAttribute('aria-haspopup') === 'menu'
      && Boolean(button.querySelector('[class*="ModelPickerTrigger"], [class*="dropdownLabelValueContent"]'))
    )) || buttons.find((button) => {
      const label = `${normalize(button.getAttribute('aria-label'))} ${normalize(button.title)} ${normalize(button.textContent)}`;
      return /模型|model|GPT|Codex|Sol|High|Medium|Low|高|中|低/i.test(label)
        && !/发送|send/i.test(label);
    }) || (state.nativeModelButton?.isConnected ? state.nativeModelButton : null);
    if (previousModelButton && previousModelButton !== modelButton) delete previousModelButton.dataset.qq2007NativeModelTrigger;
    state.nativeModelButton = modelButton;
    if (state.nativeModelButton) state.nativeModelButton.dataset.qq2007NativeModelTrigger = 'true';
  };

  const makeComposerChrome = () => {
    const chrome = create('div');
    chrome.id = 'qq2007-composer-chrome';
    const tools = create('div', 'qq2007-composer-tools');
    const toolDefinitions = [
      ['表情', 'composerEmoji', focusComposer],
      ['图片', 'composerImage', () => invoke(() => state.nativeAttachButton, focusComposer)],
      ['附加', 'composerAttach', () => invoke(() => state.nativeAttachButton, focusComposer)],
    ];
    for (const [label, asset, action] of toolDefinitions) {
      const button = create('button', 'qq2007-composer-tool');
      button.type = 'button';
      button.title = label;
      button.appendChild(makeImage(config.assets[asset], ''));
      button.appendChild(create('span', '', label));
      button.addEventListener('click', action);
      tools.appendChild(button);
    }
    const lower = create('div', 'qq2007-composer-lower');
    const model = create('button', 'qq2007-model-button', '当前模型');
    model.type = 'button';
    model.dataset.qqModelLabel = 'true';
    model.title = '选择 Codex 模型';
    model.addEventListener('click', () => invoke(() => state.nativeModelButton));
    const send = create('button', 'qq2007-send-button');
    send.type = 'button';
    send.tabIndex = -1;
    send.setAttribute('aria-hidden', 'true');
    send.setAttribute('aria-label', '发送(S)');
    send.title = '发送消息（Git 提交按钮存在时映射为发送消息）';
    send.addEventListener('click', () => {
      if (!invoke(() => state.nativeSendButton)) invoke(nativeActions.commit, focusComposer);
    });
    const sendMenu = create('button', 'qq2007-send-menu');
    sendMenu.type = 'button';
    sendMenu.setAttribute('aria-label', '发送选项');
    sendMenu.title = '发送选项';
    sendMenu.addEventListener('click', () => invoke(() => state.nativeModelButton));
    lower.append(model, send, sendMenu);
    chrome.append(tools, lower);
    return chrome;
  };

  const makeRightPanel = () => {
    const panel = create('aside');
    panel.id = 'qq2007-right-panel';
    panel.setAttribute('aria-label', 'Codex 好友');
    const header = create('div', 'qq2007-right-header');
    header.appendChild(create('strong', '', 'Codex 好友'));
    header.appendChild(makeImage(config.assets.rightControls, '', 'qq2007-right-controls'));

    const botStage = create('div', 'qq2007-bot-stage');
    botStage.appendChild(makeImage(config.assets.botStage, '蓝色机器人 Codex 小蓝'));
    const identity = create('div', 'qq2007-bot-identity');
    const onlineIcon = makeImage(config.assets.onlineIcon, '', 'qq2007-status-icon');
    onlineIcon.dataset.qqAgentDot = 'right';
    identity.appendChild(onlineIcon);
    identity.appendChild(create('strong', '', 'Codex 小蓝'));
    const level = create('span', 'qq2007-level-badge', '待同步');
    level.dataset.qqLevel = 'right-badge';
    identity.appendChild(level);
    const levelIcons = create('span', 'qq2007-level-icons');
    levelIcons.dataset.qqLevelIcons = 'right-badge';
    levelIcons.setAttribute('aria-label', 'QQ 等级图标');
    identity.appendChild(levelIcons);
    const signature = create('div', 'qq2007-signature');
    signature.appendChild(create('strong', '', '代码有问题？找我！'));
    signature.appendChild(create('span', '', '我是你的智能伙伴 Codex'));
    signature.appendChild(create('span', '', '陪你写代码、改 Bug、查文档，超可靠啦！'));
    const meta = create('span', 'qq2007-signature-meta', 'Agent 在线 · Q币余额 -- · 累计待同步');
    const statusText = create('span', 'qq2007-sr-only', '在线');
    statusText.dataset.qqAgentStatus = 'right';
    const balance = create('span', 'qq2007-sr-only', '--');
    balance.dataset.qqCoinBalance = 'right';
    const total = create('span', 'qq2007-sr-only', '待同步');
    total.dataset.qqTokenTotal = 'right';
    signature.append(meta, statusText, balance, total);

    const toolStrip = create('div', 'qq2007-right-tool-strip');
    toolStrip.appendChild(makeImage(config.assets.panelTools, '好友功能'));
    const stripActions = [focusComposer, nativeActions.plugins, nativeActions.search, nativeActions.sites, nativeActions.projects];
    stripActions.forEach((action, index) => {
      const button = create('button', '');
      button.type = 'button';
      button.title = ['发送消息', '插件', '搜索', '站点', '项目'][index];
      button.addEventListener('click', () => invoke(action, focusComposer));
      toolStrip.appendChild(button);
    });

    const friendsHeader = create('div', 'qq2007-friends-header');
    friendsHeader.appendChild(create('strong', '', '我的好友 (1/1)'));
    friendsHeader.querySelector('strong').dataset.qqFriendCount = 'true';
    const friendStage = create('div', 'qq2007-friend-stage');
    friendStage.appendChild(makeImage(config.assets.friendStage, '星空背景动漫好友形象'));
    const friendSearch = create('button', 'qq2007-friend-search');
    friendSearch.type = 'button';
    friendSearch.appendChild(create('span', '', '查找好友...'));
    friendSearch.appendChild(makeImage(config.assets.searchIcon, ''));
    friendSearch.addEventListener('click', () => invoke(nativeActions.search));
    panel.append(header, botStage, identity, signature, toolStrip, friendsHeader, friendStage, friendSearch);
    return panel;
  };

  const makeStatusBar = () => {
    const bar = create('footer');
    bar.id = 'qq2007-statusbar';
    const left = create('div', 'qq2007-status-left');
    left.appendChild(makeImage(config.assets.statusIcons, 'Codex 快捷图标'));
    const semantics = create('span', 'qq2007-sr-only', '任务等于好友消息；任务完成显示好友上线提醒；Git 提交等于发送消息');
    left.appendChild(semantics);
    const right = create('div', 'qq2007-status-right');
    right.appendChild(makeImage(config.assets.shield, '安全'));
    right.appendChild(create('span', '', '安全'));
    right.appendChild(makeImage(config.assets.signal, '本机连接'));
    const agent = create('span', 'qq2007-agent-state', '在线');
    agent.dataset.qqAgentStatus = 'statusbar';
    right.appendChild(agent);
    right.appendChild(makeImage(config.assets.flower, ''));
    const level = create('span', 'qq2007-level-status', 'LV.待同步');
    level.dataset.qqLevel = 'statusbar';
    right.appendChild(level);
    const levelIcons = create('span', 'qq2007-level-icons qq2007-level-icons-status');
    levelIcons.dataset.qqLevelIcons = 'statusbar';
    levelIcons.setAttribute('aria-label', 'QQ 等级图标');
    right.appendChild(levelIcons);
    const clock = create('time', 'qq2007-clock', '--:--');
    clock.dataset.qqClock = 'true';
    right.appendChild(clock);
    bar.append(left, right);
    return bar;
  };

  const makeToast = () => {
    const toast = create('aside');
    toast.id = 'qq2007-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.appendChild(makeImage(config.assets.botStage, ''));
    const copy = create('div', 'qq2007-toast-copy');
    const heading = create('strong', '', '好友上线');
    heading.dataset.qqToastHeading = 'true';
    const detail = create('span', '', 'Codex 小蓝已经在线');
    detail.dataset.qqToastDetail = 'true';
    copy.append(heading, detail);
    toast.appendChild(copy);
    return toast;
  };
  const showToast = (heading, detail) => {
    const toast = byId('qq2007-toast');
    if (!toast) return;
    setText(toast.querySelector('[data-qq-toast-heading]'), heading);
    setText(toast.querySelector('[data-qq-toast-detail]'), detail);
    toast.dataset.visible = 'true';
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.dataset.visible = 'false';
      state.toastTimer = null;
    }, 3400);
  };
  state.showToast = showToast;

  const textMappings = new Map([
    ['提交', '发送消息'],
    ['Commit', '发送消息'],
  ]);
  const renameTextNodes = () => {
    const roots = [document.querySelector('aside.app-shell-left-panel'), document.querySelector('main.main-surface')].filter(Boolean);
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('[id^="qq2007-"]')) continue;
        const raw = node.nodeValue || '';
        const value = normalize(raw);
        const replacement = textMappings.get(value);
        if (!replacement) continue;
        if (!state.textRenames.has(node)) state.textRenames.set(node, raw);
        node.nodeValue = raw.replace(value, replacement);
        if (node.parentElement) node.parentElement.dataset.qq2007Renamed = 'true';
      }
    }
  };
  const attributeMappings = [
    [/^提交$/i, '发送消息'],
    [/^commit$/i, '发送消息'],
  ];
  const renameAttributes = () => {
    const elements = document.querySelectorAll(
      'aside.app-shell-left-panel [aria-label], aside.app-shell-left-panel [title], main.main-surface [aria-label], main.main-surface [title]',
    );
    for (const element of elements) {
      if (element.closest('[id^="qq2007-"]')) continue;
      for (const attribute of ['aria-label', 'title']) {
        const current = normalize(element.getAttribute(attribute));
        const match = current && attributeMappings.find(([pattern]) => pattern.test(current));
        if (!match) continue;
        if (!state.attributeRenames.has(element)) state.attributeRenames.set(element, new Map());
        const originals = state.attributeRenames.get(element);
        if (!originals.has(attribute)) originals.set(attribute, element.getAttribute(attribute));
        element.setAttribute(attribute, match[1]);
        element.dataset.qq2007Renamed = 'true';
      }
    }
  };

  const detectAgentState = () => {
    if (!navigator.onLine) return 'away';
    const stopButton = Array.from(document.querySelectorAll('button')).find((button) => {
      if (!isVisible(button) || button.closest('[id^="qq2007-"]')) return false;
      const label = `${normalize(button.getAttribute('aria-label'))} ${normalize(button.textContent)}`;
      return /停止|stop/i.test(label);
    });
    if (stopButton) return 'busy';
    const approval = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
      .find((dialog) => isVisible(dialog) && /批准|审批|确认|approval|approve/i.test(normalize(dialog.textContent)));
    if (approval) return 'away';
    return document.hidden ? 'away' : 'online';
  };
  const stateLabel = (value) => ({ online: '在线', busy: '忙碌', away: '离开' }[value] || '离开');
  const updateAgentState = () => {
    const next = detectAgentState();
    const label = stateLabel(next);
    for (const node of document.querySelectorAll('[data-qq-agent-status]')) setText(node, label);
    for (const icon of document.querySelectorAll('[data-qq-agent-dot]')) icon.dataset.state = next;
    const meta = document.querySelector('.qq2007-signature-meta');
    const coin = document.querySelector('[data-qq-coin-balance="right"]')?.textContent || '--';
    const total = document.querySelector('[data-qq-token-total="right"]')?.textContent || '待同步';
    setText(meta, `Agent ${label} · Q币余额 ${coin} · 累计${total}`);
    if (state.lastAgentState === 'busy' && next === 'online') showToast('好友上线', '任务已完成，Codex 小蓝恢复在线');
    state.lastAgentState = next;
  };

  const readWeeklyQuota = () => {
    const usagePanel = Array.from(document.querySelectorAll(
      '[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]',
    )).find((element) => {
      if (!isVisible(element) || element.closest('[id^="qq2007-"]')) return false;
      const text = normalize(element.textContent);
      return /剩余用量|usage/i.test(text) && /1\s*周/.test(text) && /[0-9]{1,3}\s*%/.test(text);
    });
    const text = usagePanel ? normalize(usagePanel.textContent) : '';
    const weeklyMatch = text.match(/1\s*周\s*([0-9]{1,3})\s*%/i)
      || text.match(/([0-9]{1,3})\s*%[^%]{0,32}1\s*周/i);
    if (!weeklyMatch) return state.weeklyQuota;
    state.weeklyQuota = {
      period: '1周',
      percentage: Math.max(0, Math.min(100, Number(weeklyMatch[1]))),
    };
    persistWeeklyQuota(state.weeklyQuota);
    return state.weeklyQuota;
  };
  const updateBalance = () => {
    const weeklyQuota = readWeeklyQuota();
    const value = weeklyQuota ? `${weeklyQuota.period} ${weeklyQuota.percentage}%` : '--';
    for (const node of document.querySelectorAll('[data-qq-coin-balance]')) {
      setText(node, node.dataset.qqCoinBalance === 'left' ? `Q币余额 ${value}` : value);
      node.title = 'Q币余额直接映射为 Codex“剩余用量”中的 1 周剩余额度；读不到时显示 --';
    }
  };

  const calculateQqLevel = (tokenStats) => {
    if (!tokenStats?.available || !Number.isFinite(tokenStats.totalTokens) || tokenStats.totalTokens < 0) return null;
    const totalTokens = Math.floor(tokenStats.totalTokens);
    const level = Math.min(64, 1 + Math.floor(4 * Math.log2(1 + (totalTokens / 1000000))));
    const band = level - 1;
    const currentThreshold = level <= 1 ? 0 : Math.ceil(1000000 * ((2 ** (band / 4)) - 1));
    const nextThreshold = level >= 64 ? null : Math.ceil(1000000 * ((2 ** ((band + 1) / 4)) - 1));
    const progress = nextThreshold === null ? 100 : Math.max(0, Math.min(100, Math.floor(
      ((totalTokens - currentThreshold) / (nextThreshold - currentThreshold)) * 100,
    )));
    return { totalTokens, level, currentThreshold, nextThreshold, progress };
  };
  const compactTokens = (value) => {
    if (!Number.isFinite(value)) return '待同步';
    if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
    if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
    return new Intl.NumberFormat('zh-CN').format(value);
  };
  const getQqLevelIconParts = (level) => {
    const value = Math.max(0, Math.min(64, Math.floor(level || 0)));
    if (value >= 64) return [{ asset: 'levelCrown', label: 'QQ 等级皇冠' }];
    const parts = [];
    const suns = Math.floor(value / 16);
    const moons = Math.floor((value % 16) / 4);
    const stars = value % 4;
    for (let index = 0; index < suns; index += 1) parts.push({ asset: 'levelSun', label: 'QQ 等级太阳' });
    for (let index = 0; index < moons; index += 1) parts.push({ asset: 'levelMoon', label: 'QQ 等级月亮' });
    for (let index = 0; index < stars; index += 1) parts.push({ asset: 'levelStar', label: 'QQ 等级星星' });
    return parts;
  };
  const updateLevelIcons = (level, title) => {
    const parts = getQqLevelIconParts(level);
    for (const node of document.querySelectorAll('[data-qq-level-icons]')) {
      node.replaceChildren(...parts.map((part) => {
        const icon = makeImage(config.assets[part.asset], part.label, 'qq2007-level-icon');
        icon.dataset.qqLevelAsset = part.asset.replace(/^level/, '').toLowerCase();
        return icon;
      }));
      node.title = title;
    }
  };
  const updateTokenLevel = () => {
    const result = calculateQqLevel(state.tokenStats);
    state.qqLevel = result;
    const exact = result ? new Intl.NumberFormat('zh-CN').format(result.totalTokens) : null;
    const title = result
      ? `累计 Token：${exact}；等级公式：min(64, 1 + floor(4 × log2(1 + totalTokens / 1,000,000)))；下一级进度：${result.progress}%`
      : '未读取到可验证的本机累计 Token 数据';
    for (const node of document.querySelectorAll('[data-qq-level]')) {
      const slot = node.dataset.qqLevel;
      if (!result) setText(node, slot === 'right-badge' ? 'LV--' : 'LV.待同步');
      else if (slot === 'statusbar') setText(node, `LV.${result.level}`);
      else setText(node, `LV${String(result.level).padStart(2, '0')}`);
      node.title = title;
    }
    updateLevelIcons(result?.level, title);
    for (const node of document.querySelectorAll('[data-qq-token-total]')) {
      setText(node, result ? compactTokens(result.totalTokens) : '待同步');
      node.title = title;
    }
    return result;
  };
  state.updateTokenStats = (tokenStats) => {
    state.tokenStats = tokenStats;
    const result = updateTokenLevel();
    return { pass: Boolean(result), totalTokens: result?.totalTokens ?? null, level: result?.level ?? null };
  };

  const decorateNativeSidebar = () => {
    if (isSettingsSurface()) return;
    const aside = document.querySelector('aside.app-shell-left-panel');
    if (!aside) return;
    if (!state.nativeSearchButton?.isConnected) {
      state.nativeSearchButton = findButton({ aria: [/^搜索$/i, /^search$/i], within: aside });
    }
    if (!state.nativeProfileButton?.isConnected) {
      state.nativeProfileButton = findButton({ aria: [/个人资料/i, /profile/i, /账户/i, /account/i], within: aside });
    }
    if (state.nativeProfileButton) {
      state.nativeProfileButton.dataset.qq2007NativeProfileTrigger = 'true';
      const footer = state.nativeProfileButton.closest('div.absolute.inset-x-0.bottom-0')
        || state.nativeProfileButton.parentElement;
      if (footer) {
        footer.dataset.qq2007NativeProfileFooter = 'true';
        if (footer.parentElement) {
          footer.parentElement.dataset.qq2007NativeProfileHost = 'true';
          if (footer.parentElement.parentElement) {
            footer.parentElement.parentElement.dataset.qq2007NativeProfilePaintHost = 'true';
          }
        }
      }
    }
    const nativeCodexButton = Array.from(aside.querySelectorAll('button')).find((button) => (
      !button.closest('[id^="qq2007-"]') && /^Codex$/i.test(normalize(button.textContent))
    ));
    if (nativeCodexButton) {
      let sharedRow = nativeCodexButton;
      while (state.nativeSearchButton && sharedRow.parentElement && !sharedRow.contains(state.nativeSearchButton)) {
        sharedRow = sharedRow.parentElement;
        if (sharedRow === aside) break;
      }
      const sharedHeight = sharedRow instanceof Element ? sharedRow.getBoundingClientRect().height : 0;
      if (sharedRow !== aside && sharedHeight > 0 && sharedHeight < 90) sharedRow.dataset.qq2007NativeAsideHeader = 'true';
      else nativeCodexButton.dataset.qq2007NativeAsideHeader = 'true';
    }
    if (state.nativeSearchButton) state.nativeSearchButton.dataset.qq2007NativeSearch = 'true';
    const definitions = [
      [/^新建任务$/i, 'toolNew', 'new-task'],
      [/^已安排$/i, 'toolScheduled', 'scheduled'],
      [/^插件$/i, 'toolPlugins', 'plugins'],
      [/^站点$/i, 'toolSites', 'sites'],
      [/^拉取请求$/i, 'toolPullRequests', 'pull-requests'],
      [/^聊天$/i, 'toolChat', 'chat'],
    ];
    for (const button of aside.querySelectorAll('button, a')) {
      if (button.closest('[id^="qq2007-"]')) continue;
      const text = normalize(button.textContent);
      const definition = definitions.find(([pattern]) => pattern.test(text));
      if (!definition) continue;
      button.dataset.qq2007Nav = definition[2];
      if (!button.querySelector(':scope > .qq2007-native-nav-icon')) {
        button.insertBefore(makeImage(config.assets[definition[1]], '', 'qq2007-native-nav-icon'), button.firstChild);
      }
    }
    const pluginButton = Array.from(aside.querySelectorAll('button, a')).find((button) => (
      !button.closest('[id^="qq2007-"]') && /^插件$/i.test(normalize(button.textContent))
    ));
    if (pluginButton && !byId('qq2007-left-chat-shortcut')) {
      const chat = create('button', 'qq2007-injected-nav');
      chat.id = 'qq2007-left-chat-shortcut';
      chat.type = 'button';
      chat.title = '聊天';
      chat.appendChild(makeImage(config.assets.toolChat, '', 'qq2007-native-nav-icon'));
      chat.appendChild(create('span', '', '聊天'));
      chat.addEventListener('click', focusComposer);
      pluginButton.insertAdjacentElement('afterend', chat);
    }
    const sectionLabels = new Set(['置顶', '项目', '展开显示', '任务']);
    for (const node of aside.querySelectorAll('span, div, p, h2, h3')) {
      if (node.closest('[id^="qq2007-"]')) continue;
      if (sectionLabels.has(normalize(node.textContent)) && node.children.length === 0) {
        (node.closest('button') || node.parentElement || node).dataset.qq2007SectionHeading = 'true';
      }
    }
    const excludedFolderRows = /^(Codex|新建任务|拉取请求|站点|已安排|插件|聊天|置顶|项目|任务)$/i;
    for (const row of aside.querySelectorAll('[role="button"]')) {
      if (row.closest('[id^="qq2007-"]') || row.parentElement?.closest('[role="button"]')) continue;
      const text = normalize(row.textContent);
      if (text.length <= 3 || excludedFolderRows.test(text)) continue;
      row.dataset.qq2007FolderRow = 'true';
    }
  };

  const updateDynamicContent = () => {
    decorateNativeSidebar();
    const sessionTitle = readSessionTitle();
    for (const node of document.querySelectorAll('[data-qq-session-title]')) setText(node, `Codex 2007 - ${sessionTitle}`);
    for (const node of document.querySelectorAll('[data-qq-main-title]')) setText(node, sessionTitle);
    const visibleModelLabel = state.nativeModelButton
      ? Array.from(state.nativeModelButton.querySelectorAll('[class*="ModelPickerTriggerLabel"], [class*="dropdownLabelValueContent"]'))
        .find((node) => isVisible(node) && normalize(node.textContent))
      : null;
    const rawModelLabel = normalize(
      visibleModelLabel?.textContent
      || state.nativeModelButton?.getAttribute('aria-label')
      || state.nativeModelButton?.textContent,
    );
    const modelLabel = rawModelLabel.length > 24 ? `${rawModelLabel.slice(0, 22)}…` : rawModelLabel;
    setText(document.querySelector('[data-qq-model-label]'), modelLabel || '选择模型');
    const excludedFriendLabels = /^(Codex|新建任务|拉取请求|站点|已安排|插件|聊天|置顶|项目|任务)$/i;
    const friendNames = new Set(Array.from(document.querySelectorAll('aside.app-shell-left-panel [role="button"]'))
      .filter((node) => !node.closest('[id^="qq2007-"]'))
      .map((node) => normalize(node.textContent))
      .filter((text) => text.length > 3 && !excludedFriendLabels.test(text)));
    const total = Math.max(1, friendNames.size);
    const online = state.lastAgentState === 'online' ? Math.min(2, total) : 0;
    setText(document.querySelector('[data-qq-friend-count]'), `我的好友 (${online}/${total})`);
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const node of document.querySelectorAll('[data-qq-clock]')) {
      setText(node, clock);
      node.dateTime = now.toISOString();
    }
  };

  const findLayout = () => {
    const rootHost = document.getElementById('root');
    const aside = document.querySelector('aside.app-shell-left-panel') || document.querySelector('aside');
    const main = document.querySelector('main.main-surface') || document.querySelector('main');
    if (!rootHost || !aside || !main) return null;
    const root = Array.from(rootHost.children).find((child) => child.contains(aside) && child.contains(main))
      || rootHost.firstElementChild;
    if (!root) return null;
    let workspace = Array.from(root.children).find((child) => child.contains(aside) && child.contains(main));
    if (!workspace) {
      workspace = aside.parentElement;
      while (workspace && !workspace.contains(main)) workspace = workspace.parentElement;
    }
    if (!workspace) return null;
    const topbar = Array.from(root.children).find((child) => (
      child !== workspace && child.classList?.contains('app-header-tint') && !child.contains(main)
    )) || Array.from(root.querySelectorAll('.app-header-tint')).find((candidate) => (
      !candidate.contains(main) && !main.contains(candidate)
    ));
    return topbar ? { root, workspace, topbar, aside, main } : null;
  };

  const removeNormalThemeArtifacts = () => {
    for (const id of ['qq2007-window-title', 'qq2007-toolbar', 'qq2007-left-header', 'qq2007-left-profile', 'qq2007-main-title', 'qq2007-right-panel', 'qq2007-composer-chrome', 'qq2007-statusbar', 'qq2007-toast', 'qq2007-left-chat-shortcut', 'qq2007-home-welcome']) byId(id)?.remove();
    for (const node of document.querySelectorAll('.qq2007-native-nav-icon, .qq2007-folder-icon')) node.remove();
    for (const node of document.querySelectorAll('[data-qq2007-shell-host], [data-qq2007-workspace-host], [data-qq2007-topbar-host], [data-qq2007-nav], [data-qq2007-folder-row], [data-qq2007-section-heading], [data-qq2007-native-aside-header], [data-qq2007-native-search], [data-qq2007-native-profile-footer], [data-qq2007-native-profile-host], [data-qq2007-native-profile-paint-host], [data-qq2007-native-profile-trigger], [data-qq2007-native-model-trigger], [data-qq2007-native-send-trigger], [data-qq2007-home-suggestions], [data-qq2007-home-prompt], [data-qq2007-home-card], pre[data-qq2007-code-language]')) {
      for (const attribute of Array.from(node.attributes)) {
        if (attribute.name.startsWith('data-qq2007-')) node.removeAttribute(attribute.name);
      }
    }
  };
  const clearSettingsDecorations = () => {
    byId('qq2007-settings-title')?.remove();
    document.documentElement.removeAttribute('data-qq2007-settings-surface');
    for (const node of document.querySelectorAll('[data-qq2007-settings-host], [data-qq2007-settings-topbar], [data-qq2007-settings-sidebar], [data-qq2007-settings-main], [data-qq2007-settings-back], [data-qq2007-settings-search], [data-qq2007-settings-row], [data-qq2007-settings-heading], [data-qq2007-settings-card]')) {
      for (const attribute of Array.from(node.attributes)) {
        if (attribute.name.startsWith('data-qq2007-settings-')) node.removeAttribute(attribute.name);
      }
    }
  };
  const commonAncestor = (nodes) => {
    if (!nodes.length) return null;
    let candidate = nodes[0].parentElement;
    while (candidate && !nodes.every((node) => candidate.contains(node))) candidate = candidate.parentElement;
    return candidate;
  };
  const findSettingsMain = (root, sidebar) => {
    const heading = Array.from(root.querySelectorAll('h1, h2')).find(isVisible);
    const direct = heading?.closest('main, [role="main"]');
    if (direct) return direct;
    let current = sidebar;
    while (current?.parentElement && current.parentElement !== root) {
      const peer = Array.from(current.parentElement.children).find((node) => node !== current && node.contains(heading));
      if (peer) return peer;
      current = current.parentElement;
    }
    return heading?.parentElement || null;
  };
  const decorateSettingsSurface = () => {
    const root = document.getElementById('root');
    if (!root) return;
    if (state.settingsPaused) clearSettingsDecorations();
    root.dataset.qq2007SettingsHost = 'true';
    document.documentElement.dataset.qq2007SettingsSurface = 'true';
    const topbar = Array.from(root.querySelectorAll('header, div')).find((node) => {
      const rectangle = node.getBoundingClientRect();
      return isVisible(node)
        && rectangle.y <= 2
        && rectangle.width >= window.innerWidth * 0.9
        && (node.classList.contains('group/application-menu-top-bar') || node.tagName === 'HEADER');
    });
    if (topbar) {
      topbar.dataset.qq2007SettingsTopbar = 'true';
      let title = byId('qq2007-settings-title');
      if (!title) title = makeSettingsTitle();
      if (title.parentElement !== topbar) topbar.appendChild(title);
    }
    const search = Array.from(root.querySelectorAll('input, textarea, [contenteditable="true"]')).find((node) => /搜索设置|search settings/i.test(`${node.getAttribute('placeholder') || ''} ${node.getAttribute('aria-label') || ''}`));
    const searchHost = search?.closest('form, div') || search?.parentElement;
    if (searchHost) searchHost.dataset.qq2007SettingsSearch = 'true';
    const back = Array.from(root.querySelectorAll('button, a, [role="button"], [role="link"]')).find((node) => /^(返回应用|back to app)$/i.test(normalize(node.textContent)));
    if (back) back.dataset.qq2007SettingsBack = 'true';
    const rows = Array.from(root.querySelectorAll('[data-settings-panel-slug]'));
    for (const row of rows) row.dataset.qq2007SettingsRow = 'true';
    const sidebar = commonAncestor([...rows, searchHost, back].filter(Boolean));
    if (sidebar) sidebar.dataset.qq2007SettingsSidebar = 'true';
    const main = findSettingsMain(root, sidebar);
    if (main) {
      main.dataset.qq2007SettingsMain = 'true';
      for (const heading of main.querySelectorAll('h1, h2, h3')) heading.dataset.qq2007SettingsHeading = 'true';
      const mainRect = main.getBoundingClientRect();
      const cards = new Set();
      for (const control of main.querySelectorAll('[role="switch"], button[aria-haspopup="menu"], button[aria-expanded]')) {
        let candidate = control.parentElement;
        while (candidate && candidate !== main) {
          const rectangle = candidate.getBoundingClientRect();
          const controlCount = candidate.querySelectorAll('[role="switch"], button[aria-haspopup="menu"], button[aria-expanded]').length;
          if (rectangle.width >= Math.max(360, mainRect.width * 0.55) && rectangle.height >= 76 && rectangle.height <= 460 && controlCount >= 2) {
            cards.add(candidate);
            break;
          }
          candidate = candidate.parentElement;
        }
      }
      for (const card of cards) card.dataset.qq2007SettingsCard = 'true';
    }
  };
  const activateSettingsTheme = () => {
    if (!state.settingsPaused) removeNormalThemeArtifacts();
    document.documentElement.classList.add('qq2009-programmer-codex');
    decorateSettingsSurface();
    state.settingsPaused = true;
  };
  const ensureLayout = () => {
    const layout = findLayout();
    if (!layout) return false;
    layout.root.dataset.qq2007ShellHost = 'true';
    layout.workspace.dataset.qq2007WorkspaceHost = 'true';
    layout.topbar.dataset.qq2007TopbarHost = 'true';
    if (!byId('qq2007-window-title')) layout.topbar.appendChild(makeWindowTitle());
    let toolbar = byId('qq2007-toolbar');
    if (!toolbar) toolbar = makeToolbar();
    if (toolbar.parentElement !== layout.root || toolbar.nextElementSibling !== layout.workspace) layout.root.insertBefore(toolbar, layout.workspace);
    let leftHeader = byId('qq2007-left-header');
    if (!leftHeader || !leftHeader.querySelector('img')) {
      leftHeader?.remove();
      leftHeader = makeLeftHeader();
      layout.aside.appendChild(leftHeader);
    }
    let leftProfile = byId('qq2007-left-profile');
    if (!leftProfile || !leftProfile.querySelector('#qq2007-left-user')) {
      leftProfile?.remove();
      leftProfile = makeLeftProfile();
      layout.aside.appendChild(leftProfile);
    }
    const mainHeader = layout.main.querySelector('header.app-header-tint');
    if (mainHeader && !byId('qq2007-main-title')) mainHeader.appendChild(makeMainTitle());
    let right = byId('qq2007-right-panel');
    if (!right) right = makeRightPanel();
    if (right.parentElement !== layout.workspace) layout.workspace.appendChild(right);
    let statusbar = byId('qq2007-statusbar');
    if (!statusbar) statusbar = makeStatusBar();
    if (statusbar.parentElement !== layout.root || layout.workspace.nextElementSibling !== statusbar) {
      layout.workspace.insertAdjacentElement('afterend', statusbar);
    }
    detectComposerControls();
    const composer = findComposer();
    let composerChrome = byId('qq2007-composer-chrome');
    if (composer && (!composerChrome || !composerChrome.querySelector('.qq2007-send-button'))) {
      composerChrome?.remove();
      composerChrome = makeComposerChrome();
      composer.appendChild(composerChrome);
    }
    decorateHomeSurface();
    decorateMessageContent();
    if (!byId('qq2007-toast')) (document.body || document.documentElement).appendChild(makeToast());
    return Boolean(
      byId('qq2007-window-title')
      && byId('qq2007-toolbar')
      && byId('qq2007-left-header')
      && byId('qq2007-left-profile')
      && byId('qq2007-main-title')
      && byId('qq2007-right-panel')
      && byId('qq2007-composer-chrome')
      && byId('qq2007-statusbar')
      && byId('qq2007-toast')
    );
  };

  const reconcile = () => {
    state.reconcileQueued = false;
    if (localStorage.getItem(DISABLED_KEY) === '1') return;
    if (isSettingsSurface()) {
      activateSettingsTheme();
      return;
    }
    if (state.settingsPaused) {
      state.settingsPaused = false;
      clearSettingsDecorations();
      document.documentElement.classList.add('qq2009-programmer-codex');
    }
    ensureLayout();
    decorateHomeSurface();
    decorateMessageContent();
    renameTextNodes();
    renameAttributes();
    updateBalance();
    updateTokenLevel();
    updateAgentState();
    updateDynamicContent();
  };
  const queueReconcile = () => {
    if (state.reconcileQueued) return;
    state.reconcileQueued = true;
    setTimer(reconcile, 100);
  };

  state.cleanup = ({ restoreText = true } = {}) => {
    state.observer?.disconnect();
    state.observer = null;
    clearManagedTimers();
    clearSettingsDecorations();
    for (const id of [
      'qq2007-window-title', 'qq2007-toolbar', 'qq2007-left-header', 'qq2007-left-profile', 'qq2007-main-title',
      'qq2007-right-panel', 'qq2007-composer-chrome', 'qq2007-statusbar', 'qq2007-toast',
      'qq2007-left-chat-shortcut', 'qq2007-home-welcome', STYLE_ID,
    ]) byId(id)?.remove();
    for (const node of document.querySelectorAll('.qq2007-native-nav-icon, .qq2007-folder-icon')) node.remove();
    for (const node of document.querySelectorAll('[data-qq2007-shell-host], [data-qq2007-workspace-host], [data-qq2007-topbar-host], [data-qq2007-nav], [data-qq2007-folder-row], [data-qq2007-section-heading], [data-qq2007-native-aside-header], [data-qq2007-native-search], [data-qq2007-native-profile-footer], [data-qq2007-native-profile-host], [data-qq2007-native-profile-paint-host], [data-qq2007-native-profile-trigger], [data-qq2007-native-model-trigger], [data-qq2007-native-send-trigger], [data-qq2007-home-suggestions], [data-qq2007-home-prompt], [data-qq2007-home-card], pre[data-qq2007-code-language]')) {
      delete node.dataset.qq2007ShellHost;
      delete node.dataset.qq2007WorkspaceHost;
      delete node.dataset.qq2007TopbarHost;
      delete node.dataset.qq2007Nav;
      delete node.dataset.qq2007FolderRow;
      delete node.dataset.qq2007SectionHeading;
      delete node.dataset.qq2007NativeAsideHeader;
      delete node.dataset.qq2007NativeSearch;
      delete node.dataset.qq2007NativeProfileFooter;
      delete node.dataset.qq2007NativeProfileHost;
      delete node.dataset.qq2007NativeProfilePaintHost;
      delete node.dataset.qq2007NativeProfileTrigger;
      delete node.dataset.qq2007NativeModelTrigger;
      delete node.dataset.qq2007NativeSendTrigger;
      delete node.dataset.qq2007HomeSuggestions;
      delete node.dataset.qq2007HomePrompt;
      delete node.dataset.qq2007HomeCard;
      delete node.dataset.qq2007CodeLanguage;
    }
    if (restoreText) {
      for (const [node, original] of state.textRenames) if (node.isConnected) node.nodeValue = original;
      for (const [element, originals] of state.attributeRenames) {
        if (!element.isConnected) continue;
        for (const [attribute, original] of originals) {
          if (original === null) element.removeAttribute(attribute);
          else element.setAttribute(attribute, original);
        }
        delete element.dataset.qq2007Renamed;
      }
    }
    state.textRenames.clear();
    state.attributeRenames.clear();
    document.documentElement.classList.remove('qq2009-programmer-codex');
    for (const property of ['--qq2007-title-bg', '--qq2007-toolbar-bg', '--qq2007-panel-header-bg', '--qq2007-status-bg', '--qq2007-send-bg', '--qq2007-folder-bg']) {
      document.documentElement.style.removeProperty(property);
    }
    document.removeEventListener('visibilitychange', updateAgentState);
    window.removeEventListener('online', updateAgentState);
    window.removeEventListener('offline', updateAgentState);
    if (window[STATE_KEY] === state) delete window[STATE_KEY];
  };

  installStyle();
  setAssetVariables();
  const settingsAtStartup = isSettingsSurface();
  document.documentElement.classList.add('qq2009-programmer-codex');
  if (settingsAtStartup) activateSettingsTheme();
  const initialLayoutReady = settingsAtStartup || ensureLayout();
  if (!settingsAtStartup) {
    renameTextNodes();
    renameAttributes();
    updateBalance();
    updateTokenLevel();
    updateAgentState();
    updateDynamicContent();
  }
  state.observer = new MutationObserver(queueReconcile);
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'aria-current', 'data-active'],
  });
  document.addEventListener('visibilitychange', updateAgentState);
  window.addEventListener('online', updateAgentState);
  window.addEventListener('offline', updateAgentState);
  const interval = window.setInterval(() => {
    updateAgentState();
    updateBalance();
    updateDynamicContent();
  }, 1000);
  state.timers.add(interval);
  setTimer(() => showToast('好友上线', 'Codex 2007 视觉层已启用'), 500);

  return {
    pass: initialLayoutReady,
    reason: initialLayoutReady ? null : 'native-shell-not-ready',
    version: state.version,
    visualVersion: 'Codex 2007',
    nodes: {
      titlebar: Boolean(byId('qq2007-window-title')),
      toolbar: Boolean(byId('qq2007-toolbar')),
      mainTitle: Boolean(byId('qq2007-main-title')),
      rightPanel: Boolean(byId('qq2007-right-panel')),
      composerChrome: Boolean(byId('qq2007-composer-chrome')),
      statusbar: Boolean(byId('qq2007-statusbar')),
    },
  };
})()
