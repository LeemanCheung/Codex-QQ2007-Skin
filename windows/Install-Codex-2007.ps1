#requires -Version 5.1

param([switch]$NoLaunch)

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    $legacy = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $forward = @()
    if ($NoLaunch) { $forward += '-NoLaunch' }
    & $legacy -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @forward
    exit $LASTEXITCODE
}

. (Join-Path $PSScriptRoot 'Common.ps1')

try {
    $sourceRoot = Get-QQPackageRoot
    $installRoot = Join-Path $script:QQStateRoot 'packages\1.0.0'
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

    $copyManifest = [ordered]@{
        assets = @(
            'codex2007-title-bg.png', 'codex2007-toolbar-bg.png',
            'codex2007-panel-header-bg.png', 'codex2007-status-bg.png',
            'codex2007-window-controls.png', 'codex2007-penguin.png',
            'codex2007-tool-new.png', 'codex2007-tool-scheduled.png',
            'codex2007-tool-plugins.png', 'codex2007-tool-sites.png',
            'codex2007-tool-pr.png', 'codex2007-tool-chat.png',
            'codex2007-bot-stage.png', 'codex2007-bot-stage.gif',
            'qq-retro-stage.png', 'qq-retro-stage.gif', 'codex2007-friend-stage.png',
            'codex2007-status-icons.png', 'codex2007-shield.png',
            'codex2007-signal.png', 'codex2007-flower.png',
            'codex2007-composer-emoji.png', 'codex2007-composer-image.png',
            'codex2007-composer-attach.png', 'codex2007-send.png',
            'codex2007-online.png', 'codex2007-panel-tools.png',
            'codex2007-caret.png', 'codex2007-right-controls.png',
            'codex2007-search.png', 'codex2007-folder.png',
            'qq-level-star.png', 'qq-level-moon.png',
            'qq-level-sun.png', 'qq-level-crown.png',
            'QQ_LEVEL_ICON_SOURCE.md'
        )
        src = @('injector.mjs', 'token-stats.mjs', 'skin-runtime.js', 'skin.css')
        windows = @(
            'Common.ps1', 'Start-Codex-2007.ps1',
            'Restore-Codex.ps1', 'Install-Codex-2007.ps1'
        )
        docs = @(
            'INSTALLATION.md', 'USAGE.md', 'ARCHITECTURE.md',
            'TROUBLESHOOTING.md', 'COMPATIBILITY.md', 'VERIFICATION.md',
            'PRIVACY.md', 'SOURCES.md'
        )
    }
    foreach ($directory in $copyManifest.Keys) {
        $destination = Join-Path $installRoot $directory
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        foreach ($name in $copyManifest[$directory]) {
            $source = Join-Path (Join-Path $sourceRoot $directory) $name
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "安装包缺少文件：$directory\$name"
            }
            Copy-Item -LiteralPath $source -Destination (Join-Path $destination $name) -Force
        }
    }
    foreach ($file in @(
        'README.md', 'SECURITY.md', 'LICENSE.txt', 'NOTICE.txt', 'manifest.json',
        'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
        'SUPPORT.md', 'design-qa.md'
    )) {
        $source = Join-Path $sourceRoot $file
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $installRoot $file) -Force
        }
    }

    $codex = Get-QQCodexInstall
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shell = New-Object -ComObject WScript.Shell
    $shortcutLocations = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('Programs')
    ) | Where-Object { $_ } | Sort-Object -Unique

    $createdShortcuts = @()
    foreach ($location in $shortcutLocations) {
        $startLink = Join-Path $location 'Codex 2007.lnk'
        $startShortcut = $shell.CreateShortcut($startLink)
        $startShortcut.TargetPath = $windowsPowerShell
        $startShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'windows\Start-Codex-2007.ps1') + '"'
        $startShortcut.WorkingDirectory = $installRoot
        $startShortcut.IconLocation = $codex.Executable + ',0'
        $startShortcut.Description = '启动 Codex 2007'
        $startShortcut.Save()
        $createdShortcuts += $startLink

        $restoreLink = Join-Path $location '恢复原版 Codex.lnk'
        $restoreShortcut = $shell.CreateShortcut($restoreLink)
        $restoreShortcut.TargetPath = $windowsPowerShell
        $restoreShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'windows\Restore-Codex.ps1') + '"'
        $restoreShortcut.WorkingDirectory = $installRoot
        $restoreShortcut.IconLocation = $codex.Executable + ',0'
        $restoreShortcut.Description = '恢复官方 Codex 外观并关闭主题接口'
        $restoreShortcut.Save()
        $createdShortcuts += $restoreLink
    }

    $installState = [ordered]@{
        product = $script:QQProductName
        version = $script:QQVersion
        packageRoot = [IO.Path]::GetFullPath($installRoot)
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
        shortcuts = $createdShortcuts
    }
    $installJson = $installState | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText((Join-Path $script:QQStateRoot 'install.json'), $installJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

    Write-Host "安装完成：$installRoot" -ForegroundColor Green
    Write-Host '桌面已创建“Codex 2007”和“恢复原版 Codex”快捷方式。'
    if (-not $NoLaunch) {
        & (Join-Path $installRoot 'windows\Start-Codex-2007.ps1')
        exit $LASTEXITCODE
    }
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
