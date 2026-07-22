# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use semantic versioning where practical.

## [Unreleased]

## [1.1.0] - 2026-07-22

### Added

- 新增白名单发布构建脚本，生成带内部文件清单和独立 SHA-256 校验文件的用户安装 ZIP。

### Changed

- 项目名称统一为“Codex 2007”；同步更新界面标题、设置页、运行时标识、安装目录、脚本入口、快捷方式、文档与验证契约。
- 左侧原生导航的重复线框图标已隐藏，只保留 QQ 服务图标；原有按钮文本、路由和点击语义不变。
- 原生“允许一次/拒绝”审批卡进入交互保护态：守护器不再因模型按钮暂时不可用而重注入皮肤，运行时也不在审批期间重绘会话层。
- 新建任务首页升级为 Codex 2007 服务台任务卡；全屏时原生“输出/来源”或“环境信息”浮层会暂时让出右侧好友栏，并为会话正文预留宽度。
- 浮层检测改为读取原生展开动画矩阵：仅位移归零、缩放恢复的真实打开态触发布局；已滑出的残留节点和普通会话文本不会隐藏好友栏。
- 设置页侧栏及其内层包装器补齐完整 flex 高度链；分类导航占满搜索框下方剩余空间，并在窗口不足时独立滚动。
- 设置页识别改用稳定的“搜索设置”标记，并通过安全刷新轮询维持导航装饰；监视器不再对已打开的设置页执行完整重注入，避免菜单被清空或退回会话。
- 右下角 QQ 秀替换为项目原创的 QQ Retro 企鹅形象；右上角 Codex 小蓝保持不变。
- 右侧 Codex 小蓝与 QQ Retro 企鹅升级为轻量循环 GIF：小蓝双手交替敲击复古键盘，企鹅独立挥动抬起的手臂并眨眼；系统开启“减少动态效果”时自动回退原静态 PNG。
- 完成消息底部的原生复制、喜欢、不喜欢和继续新任务按钮改为 QQ2007 彩色图标，并显示“复制、赞、踩、分享”；原生点击处理与可访问名称保持不变。
- 消息操作栏只装饰恰好包含复制、喜欢、不喜欢和继续新任务四种动作的紧凑原生容器；不再误标整条虚拟会话，避免长命令撑大内容宽度并造成左右错位。
- 会话标题根据固定标题栏与主内容左边缘的实际差值动态增加安全间距，避免与左栏折叠控件重叠。
- README 重构为 QQ2007 项目视觉首页，加入真实动图、功能差异、工作流程、快速安装和安全边界导航。

- 设置页改为 QQ2007 原生视觉层：真实应用顶栏显示“Codex 2007 - 设置”，设置导航、搜索框和表单卡片采用复古蓝色风格。
- 保留并验证所有原生设置服务行、服务图标、开关和下拉菜单；不再以“暂停主题”方式退回官方设置页。
- 设置页验收契约新增 `settingsThemeApplied`、`settingsRowsDecorated` 和 `settingsChromeReady`。

## [1.0.0] - 2026-07-21

### Added

- Codex 2007 标题栏、六项工具栏、三栏工作区、输入区、好友栏与状态栏。
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

[Unreleased]: https://github.com/LeemanCheung/Codex-QQ2007-Skin/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/LeemanCheung/Codex-QQ2007-Skin/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/LeemanCheung/Codex-QQ2007-Skin/releases/tag/v1.0.0
