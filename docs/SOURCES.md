# 信息与素材来源

访问日期：2026-07-21。

| 来源 | 本项目使用范围 | 说明 |
| --- | --- | --- |
| [Randy Lu 的概念帖](https://x.com/randyloop/status/2077813650564452850) | 项目灵感与公开来源追溯 | 仅参考概念方向；未复制主题包或代码 |
| 开发期间保存的“Codex 2007”参考图 | 唯一详细视觉验收基准 | 本机参考证据未提交，避免附带来源不明素材和个人信息 |
| [腾讯 QQ 官网](https://im.qq.com/) | 产品名称与权利归属识别 | 不代表腾讯授权或背书 |
| [腾讯新闻：QQ 等级历史说明（2022）](https://news.qq.com/rain/a/20221212A020BZ00) | 1/4/16/64 星月太阳皇冠换算 | 文中明确说明四进制等级关系 |
| [腾讯新闻：QQ 等级回顾（2025）](https://news.qq.com/rain/a/20250606A07IDK00) | 四进制体系的交叉核对 | 二级报道，用于历史背景佐证 |
| [OpenAI：Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/) | Windows Codex 桌面应用的官方产品背景 | 宿主应用与本项目无隶属关系 |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) | CDP 能力、端点和兼容性风险 | 官方文档说明协议可用于检查/控制 Chromium，tip-of-tree 不保证向后兼容 |
| [Microsoft：about_Execution_Policies](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies) | `-ExecutionPolicy Bypass` 的进程范围说明 | 安装器不调用 `Set-ExecutionPolicy` |

## 本项目实证

以下结论来自源码与真实 Codex 运行验证，而非上述网页：

- 选择器与 DOM 兼容性；
- 主题节点尺寸和三栏布局；
- 正常页、设置页及原生点击命中结果；
- Codex `26.715.4045.0`、`26.715.7063.0` 与 `26.715.8383.0` 的验收结果；
- Token 统计器的读取边界。

这些运行证据可能包含个人任务、路径和用量，因此仓库只保留脱敏后的结论与复现方法，不提交原始 JSON、DOM 或截图。

## 素材声明

- `codex2007-*`：为本项目制作的界面、角色和背景素材。
- `qq-retro-stage.png`：以用户提供的经典 QQ 企鹅截图作为形象与身材比例参考生成，不直接包含参考截图的原始像素、Logo 或文字；QQ 企鹅形象及相关权利归腾讯所有，本项目不代表腾讯授权或背书。
- `codex2007-bot-typing-sprites.png`、`qq-retro-wave-sprites.png`：前者以项目自有角色 PNG 为参考；后者以用户提供的经典 QQ 企鹅截图为比例参考，使用内置图像生成工具生成并编辑为带轻微早期客户端像素质感的 2×2 挥手眨眼动作关键帧。
- `codex2007-bot-stage.gif`、`qq-retro-stage.gif`：由上述关键帧通过 `scripts/build-animated-stages.py` 确定性裁切、统一背景并编排生成；GIF 不引入新的第三方素材。
- `qq-level-*`：从历史等级参考图提取的第三方经典等级图标，不属于 MIT 授权，详见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
- 未打包第三方换肤引擎、原始 QQ 主题包或修改后的 Codex 二进制。
