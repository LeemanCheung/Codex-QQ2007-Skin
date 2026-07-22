# 验证指南

## 静态验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-Package.ps1
```

该脚本检查 JavaScript 语法、PowerShell 语法、manifest 入口、必需素材、文档链接和不应提交的运行态文件。

## 正常页实机验收

从独立 PowerShell 窗口运行启动脚本。它会关闭当前 Codex 后重新启动，因此不要在正在执行验证的同一 Codex 任务里运行。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Start-Codex-2007.ps1
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
- 右栏两张形象图在默认动态偏好下使用内嵌 GIF；系统开启“减少动态效果”时改用静态 PNG。
- `mainTitleClearOfLeftRail=true`，且 `mainTitleIconLeft` 至少比 `mainSurfaceLeft` 大 6px。
- 页面存在完成消息操作栏时，`classicMessageActionsReady=true`，原生复制/喜欢/不喜欢/继续新任务按钮均保留并套用复古图标与文字。
- `classicMessageActionStripsScoped=true`，每个复古操作栏恰好包含四种动作，且不会标记整条虚拟会话。
- `conversationTurnsContained=true`，当前可见的每条会话均完整位于中央会话安全区内；长命令、附件和处理中状态不得让消息侵入左右栏。

## 设置页实机验收

1. 点击左下角个人资料并进入设置。
2. 确认原生设置页已套用 QQ2007 蓝色窗框、左侧分组、搜索框与表单卡片，而没有插入替代菜单。
3. 确认设置服务行可见且每行保留对应的原生 SVG/图片、开关、下拉菜单和点击行为。
4. 运行 `injector.mjs verify` 指向本次实际端口。

接受字段：

```text
pass=true
nativeAppIntact=true
classApplied=true
settingsSurface=true
settingsMenuIntact=true
settingsThemeApplied=true
settingsRowsDecorated=true
settingsChromeReady=true
settingsSidebarFillsPane=true
settingsNavigationFillsPane=true
settingsNavigationContentReady=true
settingsRowsSized=true
settingsServiceIconsReady=true
```

`settingsSidebarRect.bottom` 应与视口高度一致（允许 2px 渲染误差），避免内部纵向容器被误设为 300px 高的侧栏。

## 视觉检查

对照 [design-qa.md](../design-qa.md) 的七个区域检查明显偏差。截图只保存在本机 runtime 目录；公开前必须裁掉或遮盖任务、项目、账号、用量、路径和消息正文。

## 失败处理

验证失败时保留本机证据，先判断是原生 DOM 未挂载、选择器漂移、布局尺寸、点击命中还是设置页误判。禁止仅删除验收条件来获得 `pass=true`。
