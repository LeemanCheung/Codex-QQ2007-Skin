# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use semantic versioning where practical.

## [Unreleased]

### Changed

- 左侧原生导航的重复线框图标已隐藏，只保留 QQ 服务图标；原有按钮文本、路由和点击语义不变。
- 原生“允许一次/拒绝”审批卡进入交互保护态：守护器不再因模型按钮暂时不可用而重注入皮肤，运行时也不在审批期间重绘会话层。
- 新建任务首页升级为 QQ 程序员服务台任务卡；全屏时原生输出/来源面板会暂时让出右侧好友栏，并为会话正文预留宽度。

- 设置页改为 QQ2007 原生视觉层：真实应用顶栏显示“Codex 2007 - 设置”，设置导航、搜索框和表单卡片采用复古蓝色风格。
- 保留并验证所有原生设置服务行、服务图标、开关和下拉菜单；不再以“暂停主题”方式退回官方设置页。
- 设置页验收契约新增 `settingsThemeApplied`、`settingsRowsDecorated` 和 `settingsChromeReady`。

## [1.0.0] - 2026-07-21

### Added

- Codex 2007-inspired title bar, six-action toolbar, three-column workspace, composer chrome, friend panel, and status bar.
- Native profile, model, attachment, navigation, and send action mapping.
- Weekly remaining-usage display, Agent state mapping, local Token statistics, and 1–64 level calculation.
- Classic star, moon, sun, and crown level composition.
- Settings-surface suspension with native service-row/icon verification.
- Safe Windows install, launch, watcher, verification, and restore scripts.

### Security

- Loopback-only CDP discovery and process/path validation.
- No remote theme assets, no third-party runtime engine, and no modification of Codex binaries or `.codex/config.toml`.

### Compatibility

- Verified against Codex `26.715.4045.0` and `26.715.7063.0`.

[Unreleased]: https://github.com/LeemanCheung/Codex-QQ2007-Skin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LeemanCheung/Codex-QQ2007-Skin/releases/tag/v1.0.0
