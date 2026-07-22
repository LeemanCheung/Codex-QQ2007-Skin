# 故障排查

## 启动后没有皮肤

1. 确认使用主题快捷方式，而不是官方 Codex 图标。
2. 检查 Node.js：`node --version`，需要 22+。
3. 重新运行启动脚本并记录退出码。
4. 查看 `%LOCALAPPDATA%\Codex2007\runtime\verify.json` 的 `pass`、`nativeAppIntact` 和 `visualContract`，不要公开完整文件。

## 启动器报告“主题布局验收未通过”

Codex 可能已升级并改变 DOM。重点检查：

- `nodes` 中哪个主题节点为 `null` 或不可见；
- `nativeProfileActionReady`、`nativeModelActionReady`、`nativeSendActionReady`；
- `sendVisualHitTarget`；
- `nativeMenuButtonsVisible` 与 `horizontalOverflow`。

先运行恢复脚本。若问题可复现，请在 Issue 中提供脱敏后的上述字段和 Codex 版本，不要上传任务标题、Token 数、账号或绝对路径。

## 设置菜单缺失或被主题覆盖

当前实现要求设置页同时出现“搜索设置”和“返回应用”语义链接后，将 QQ2007 样式附着到原生设置节点。它不创建替代设置菜单，也不隐藏服务行。正常状态应为：

```text
settingsSurface=true
settingsMenuIntact=true
settingsThemeApplied=true
settingsRowsDecorated=true
settingsChromeReady=true
classApplied=true
```

如果不满足，恢复官方外观并重新启动。新版 Codex 可能增加或移除设置入口；验收器会检查当前实际存在的服务行，而不会伪造官方已移除的菜单。

## 个人资料、模型或发送按钮无法点击

这些动作必须命中原生控件。若按钮看得到但无法点击，检查对应 `native*ActionReady` 与 `sendVisualHitTarget`。不要通过删除验证条件绕过；应更新原生选择器或堆叠层级。

## Q币余额为 `--`

打开个人资料菜单中的“剩余用量”，等待“1 周”百分比出现。主题只使用该真实读数。窗口缓存超过 6 小时、页面结构变化或账号不提供该字段时仍显示 `--`。

## QQ等级未更新

- 确认本机 Codex 会话目录可读；
- 确认 JSONL 中存在 Token 统计事件；
- 等待最多 60 秒；
- 符号链接、过深目录或超过扫描上限的异常目录会被主动跳过。

## 恢复脚本拒绝操作

恢复脚本在进程、路径或 Junction 目标无法验证时会安全停止。不要手工递归删除未知目录。先保存脱敏错误，再确认主题安装目录和状态文件是否完整。
