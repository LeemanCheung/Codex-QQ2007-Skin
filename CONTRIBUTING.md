# 贡献指南

感谢改进项目。提交前请先阅读 [SECURITY.md](SECURITY.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 工作流程

1. 创建 Issue 描述 Codex 版本、预期行为和已脱敏证据；安全问题请使用私密 Security Advisory。
2. 从 `main` 创建短分支，只修改与问题相关的文件。
3. 不提交运行态 JSON、日志、截图、账号、额度、会话标题、绝对用户路径或其他个人信息。
4. 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Package.ps1`。
5. 涉及 DOM/CSS 时，在真实 Codex 中验证正常页和设置页，并确认恢复脚本可用。
6. PR 说明根因、实现、验证结果、风险和兼容版本。

## 设计原则

- 保留原生 Codex 交互，合成控件不得替代真实发送、模型、个人资料或导航动作。
- 选择器优先使用语义属性和稳定容器，并为 DOM 变更提供可验证的降级路径。
- 读不到用量或状态时显示未知值，不猜测、不复用不相干指标。
- 不增加远程脚本、遥测、第三方主题引擎或对 Codex 二进制的修改。
- 新增素材必须说明来源、授权和是否属于 MIT 许可证。

## 提交建议

提交信息使用简短祈使句，例如 `Fix settings surface detection`。一个提交尽量只解决一个问题，避免夹带格式化或无关生成物。
