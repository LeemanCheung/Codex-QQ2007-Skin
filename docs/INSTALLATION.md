# 安装与卸载

## 环境要求

- Windows 10 或 Windows 11；
- 官方 Windows Codex 桌面应用；
- Node.js 22 或更高版本，`node.exe` 可从 `PATH` 找到；
- Windows PowerShell 5.1。安装器从 PowerShell 7 启动时会自动转交给 5.1。

## 安装前检查

1. 从 GitHub Releases 或仓库下载源码。
2. 查看 [SECURITY.md](../SECURITY.md) 与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
3. 如使用发布包，先按同名 `.sha256` 文件校验 ZIP，再按包内 `PACKAGE-SHA256SUMS` 校验解压后的文件。
4. 关闭不可信的本机程序；主题运行期间会开放回环 CDP 端口。

## 安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Install-Codex-2007.ps1
```

安装器会把运行必需文件复制到：

```text
%LOCALAPPDATA%\Codex2007\packages\1.1.0
```

并在桌面、开始菜单创建“Codex 2007”和“恢复原版 Codex”。产品名称、安装目录、脚本入口与界面标题均使用 Codex 2007 命名。

安装器随后会：

1. 发现官方 Codex 包和可执行文件；
2. 选择仅绑定 `127.0.0.1` 的空闲端口；
3. 使用指向原 Codex 用户数据目录的已校验 Junction 启动应用；
4. 等待原生 DOM 完整挂载；
5. 启动注入守护进程并运行独立验收；
6. 仅在 `pass=true` 且 `nativeAppIntact=true` 时返回 0。

若不希望安装后立即重启 Codex：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Install-Codex-2007.ps1 -NoLaunch
```

## 启动

以后从主题快捷方式启动，或运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Start-Codex-2007.ps1
```

如首选端口被占用，可指定另一个首选端口；脚本仍会验证实际监听者和回环地址：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Start-Codex-2007.ps1 -PreferredPort 9350
```

## 更新

下载新版本后重新运行安装器。安装器只覆盖主题包文件和快捷方式，不清除 Codex 聊天、项目、设置或用户数据。更新前建议先运行恢复脚本关闭旧守护进程。

## 恢复官方外观

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Restore-Codex.ps1
```

恢复脚本会校验状态文件、进程命令行、注入器路径和 Junction 目标后再停止主题进程并重启官方应用。它不会删除 Codex 数据，也不会修改 `.codex/config.toml`。

## PowerShell 执行策略说明

命令中的 `-ExecutionPolicy Bypass` 只影响新启动的 PowerShell 进程及其子进程，关闭后失效；不会调用 `Set-ExecutionPolicy` 修改用户或系统范围。微软说明见 [about_Execution_Policies](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies)。
