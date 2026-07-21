# 验证指南

## 静态验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Package.ps1
```

该脚本检查 JavaScript 语法、PowerShell 语法、manifest 入口、必需素材、文档链接和不应提交的运行态文件。

## 正常页实机验收

从独立 PowerShell 窗口运行启动脚本。它会关闭当前 Codex 后重新启动，因此不要在正在执行验证的同一 Codex 任务里运行。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Start-QQ2009-Programmer-Codex.ps1
echo $LASTEXITCODE
```

接受标准：

- 退出码 0；
- `runtime\verify.json` 中 `pass=true`、`nativeAppIntact=true`；
- 六个工具栏入口；
- 个人资料、模型和发送原生动作就绪；
- 发送可见区域命中原生按钮；
- 标题栏 41px、工具栏 54px、状态栏 32px；
- 无水平溢出，经典等级图标为内嵌 PNG。

## 设置页实机验收

1. 点击左下角个人资料并进入设置。
2. 确认 QQ 标题栏、工具栏、右侧栏和状态栏撤出。
3. 确认设置服务行可见且每行具有对应的原生 SVG/图片。
4. 运行 `injector.mjs verify` 指向本次实际端口。

接受字段：

```text
pass=true
nativeAppIntact=true
classApplied=false
settingsSurface=true
settingsMenuIntact=true
settingsThemeSuspended=true
settingsServiceIconsReady=true
```

## 视觉检查

对照 [design-qa.md](../design-qa.md) 的七个区域检查明显偏差。截图只保存在本机 runtime 目录；公开前必须裁掉或遮盖任务、项目、账号、用量、路径和消息正文。

## 失败处理

验证失败时保留本机证据，先判断是原生 DOM 未挂载、选择器漂移、布局尺寸、点击命中还是设置页误判。禁止仅删除验收条件来获得 `pass=true`。
