# Codex QQ2007 Skin

面向 Windows Codex 桌面应用的非官方 QQ2007 怀旧视觉层。项目以一张公开概念图为灵感，在不修改 Codex 安装包、应用签名、聊天数据库或用户配置的前提下，将原生界面映射为经典蓝色标题栏、工具栏、好友面板和状态栏。

> 本项目与腾讯、QQ、OpenAI 均无隶属、授权或背书关系。`QQ`、`Codex` 及相关标识属于各自权利人。代码采用 MIT 许可证；第三方图标不在 MIT 授权范围内，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 功能

- 顶部 `Codex 2007 - <当前任务>` 标题栏和六项原生导航工具栏。
- 左侧任务/项目列表、中央原生聊天与输入区、右侧好友卡和底部状态栏。
- 原生个人资料、模型选择、附件和发送按钮保持可点击；可见 QQ 控件只负责呈现。
- “Q币余额”只显示个人资料中“剩余用量 → 1 周”的真实剩余百分比，读取不到时显示 `--`。
- Agent 状态映射为在线、忙碌、离开；任务完成提示映射为“好友上线”。
- 累计本地 Token 用量映射为 1–64 级 QQ 等级，每 60 秒刷新。
- 设置页同样采用 QQ2007 蓝色标题栏、分组侧栏和表单卡片；所有设置服务行、原生图标、开关与下拉菜单保持可用。
- 一键恢复官方外观并关闭本机调试端口。

## QQ 等级

```text
等级 = min(64, 1 + floor(4 × log2(1 + 累计Token / 1,000,000)))
```

等级值使用项目自己的对数曲线；星星/月亮/太阳/皇冠的四进制组合沿用经典 QQ 表达：1、4、16、64。该换算规则可见[腾讯新闻的历史说明](https://news.qq.com/rain/a/20221212A020BZ00)。

## 快速安装

要求：Windows 10/11、官方 Windows Codex 桌面应用、Node.js 22+。

```powershell
git clone https://github.com/LeemanCheung/Codex-QQ2007-Skin.git
cd Codex-QQ2007-Skin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Install-QQ2009-Programmer-Codex.ps1
```

安装完成后使用桌面或开始菜单中的“QQ2009 程序员版 Codex”快捷方式启动。该名称是早期安装器的兼容标识，实际视觉基准为 Codex 2007。直接启动官方 Codex 不会应用皮肤。

只安装、不立即重启：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Install-QQ2009-Programmer-Codex.ps1 -NoLaunch
```

恢复官方外观：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Restore-Codex.ps1
```

`-ExecutionPolicy Bypass` 仅作用于该次 PowerShell 进程，不修改系统执行策略。完整步骤见 [安装文档](docs/INSTALLATION.md)。

## 安全边界

主题通过只监听 `127.0.0.1` 的 Chromium DevTools Protocol（CDP）注入本地 DOM/CSS。CDP 能控制渲染器，属于明确的本机攻击面；使用结束后可运行恢复脚本关闭端口。主题不读取或修改 `.codex/config.toml`，不请求第三方网络资源，也不上传 Token 统计或聊天正文。详见 [SECURITY.md](SECURITY.md) 与 [隐私说明](docs/PRIVACY.md)。

## 兼容性与验收

已在 Codex `26.715.4045.0` 和 `26.715.7063.0` 实机验证。Codex DOM 不是公开稳定 API，应用升级后选择器仍可能变化；启动器会在结构不匹配时返回非零退出码，而不是报告伪成功。

最终验收要求包括：

- `verify.json` 中 `pass=true`、`nativeAppIntact=true`；
- 六个工具栏入口、个人资料、模型选择和发送控件可用；
- 无水平溢出，标题栏、输入区和状态栏尺寸满足契约；
- 设置页 QQ2007 视觉层已附着到原生节点，当前服务行、原生图标、开关和下拉菜单均可见可用。

验证方法见 [docs/VERIFICATION.md](docs/VERIFICATION.md)，版本说明见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。运行态 JSON 和截图可能包含任务名称、用量等个人信息，因此不会提交到仓库。

## 文档

- [安装](docs/INSTALLATION.md) · [使用](docs/USAGE.md) · [故障排查](docs/TROUBLESHOOTING.md)
- [架构](docs/ARCHITECTURE.md) · [兼容性](docs/COMPATIBILITY.md) · [验证](docs/VERIFICATION.md)
- [隐私](docs/PRIVACY.md) · [信息与素材来源](docs/SOURCES.md) · [安全报告](SECURITY.md)
- [贡献指南](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [支持](SUPPORT.md)

## 来源与独立实现

视觉方向参考 [Randy Lu 发布的概念图](https://x.com/randyloop/status/2077813650564452850)。实现代码、布局逻辑和项目素材均由本项目独立编写或制作；未引用 `zhulin025/Codex-QQ-Skin`、第三方换肤引擎或修改后的 Codex 二进制。完整来源、用途和访问日期见 [docs/SOURCES.md](docs/SOURCES.md)。

## 许可证

项目代码及明确标注为项目原创的素材采用 [MIT License](LICENSE.txt)。经典 QQ 等级图标和产品名称不随 MIT 授权，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
