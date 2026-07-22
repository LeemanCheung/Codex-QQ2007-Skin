#requires -Version 5.1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$failures = [Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    $failures.Add($Message)
}

function Test-JavaScriptSyntax {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $node) {
        Add-Failure 'node.exe was not found on PATH.'
        return
    }
    foreach ($file in @('src/injector.mjs', 'src/token-stats.mjs', 'src/skin-runtime.js')) {
        & $node.Source --check (Join-Path $root $file)
        if ($LASTEXITCODE -ne 0) { Add-Failure "JavaScript syntax failed: $file" }
    }
}

function Test-PowerShellSyntax {
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' -File) {
        $tokens = $null
        $errors = $null
        # Windows PowerShell 5.1 may decode a UTF-8 file without BOM using the
        # legacy system code page. Read UTF-8 explicitly before parsing so CI
        # validates the same Chinese source text that Node and Git preserve.
        $source = [IO.File]::ReadAllText($file.FullName, [Text.UTF8Encoding]::new($false))
        [Management.Automation.Language.Parser]::ParseInput($source, $file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        foreach ($parseError in @($errors)) {
            Add-Failure "PowerShell syntax failed: $($file.FullName.Substring($root.Length + 1)): $($parseError.Message)"
        }
    }
}

function Test-Manifest {
    try { $manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Add-Failure "manifest.json is invalid: $($_.Exception.Message)"; return }
    if ([string]$manifest.version -notmatch '^\d+\.\d+\.\d+$') { Add-Failure 'manifest version must use semantic versioning.' }
    if ($manifest.id -ne 'codex-2007') { Add-Failure 'manifest id must be codex-2007.' }
    if ($manifest.name -ne 'Codex 2007') { Add-Failure 'manifest name must be Codex 2007.' }
    foreach ($property in $manifest.entrypoints.PSObject.Properties) {
        $path = Join-Path $root ([string]$property.Value)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Add-Failure "Missing entrypoint: $($property.Value)" }
    }
    foreach ($asset in @($manifest.thirdPartyAssets)) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $asset) -PathType Leaf)) { Add-Failure "Missing declared third-party asset: $asset" }
    }
}

function Test-VersionConsistency {
    $manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = [string]$manifest.version
    $common = Get-Content -LiteralPath (Join-Path $root 'windows/Common.ps1') -Raw -Encoding UTF8
    $installer = Get-Content -LiteralPath (Join-Path $root 'windows/Install-Codex-2007.ps1') -Raw -Encoding UTF8
    $installation = Get-Content -LiteralPath (Join-Path $root 'docs/INSTALLATION.md') -Raw -Encoding UTF8
    $changelog = Get-Content -LiteralPath (Join-Path $root 'CHANGELOG.md') -Raw -Encoding UTF8
    if (-not $common.Contains("`$script:QQVersion = '$version'")) {
        Add-Failure "windows/Common.ps1 version does not match manifest: $version"
    }
    if (-not $installer.Contains("Join-Path (Join-Path `$script:QQStateRoot 'packages') `$script:QQVersion")) {
        Add-Failure 'Installer package path must derive from the canonical runtime version.'
    }
    if (-not $installation.Contains("packages\$version")) {
        Add-Failure "Installation documentation does not contain package version $version."
    }
    if (-not $changelog.Contains("## [$version]")) {
        Add-Failure "CHANGELOG.md does not contain version $version."
    }
}

function Test-CanonicalProductNaming {
    $canonical = 'Codex 2007'
    $requiredFiles = @(
        'README.md', 'CHANGELOG.md', 'manifest.json',
        'src/skin-runtime.js', 'src/injector.mjs',
        'windows/Common.ps1', 'windows/Install-Codex-2007.ps1',
        'windows/Start-Codex-2007.ps1', 'windows/Restore-Codex.ps1'
    )
    foreach ($file in $requiredFiles) {
        $content = Get-Content -LiteralPath (Join-Path $root $file) -Raw -Encoding UTF8
        if (-not $content.Contains($canonical)) {
            Add-Failure "Canonical product name is missing from $file"
        }
    }
    foreach ($oldFile in @(
        'windows/Install-QQ2009-Programmer-Codex.ps1',
        'windows/Start-QQ2009-Programmer-Codex.ps1',
        'windows/Install-QQ2007-Programmer-Edition.ps1',
        'windows/Start-QQ2007-Programmer-Edition.ps1'
    )) {
        if (Test-Path -LiteralPath (Join-Path $root $oldFile)) {
            Add-Failure "Legacy-named entrypoint must not remain: $oldFile"
        }
    }
    foreach ($contract in @('codex-2007', 'Codex2007', 'CODEX_2007')) {
        $found = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
            $_.FullName -notmatch '[\\/]\.git[\\/]' -and $_.FullName -notmatch '[\\/]artifacts[\\/]' -and
            $_.Name -ne 'SHA256SUMS' -and $_.Extension -in @('.js', '.mjs', '.css', '.ps1', '.json')
        } | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8).Contains($contract) }
        if (-not $found) { Add-Failure "Missing canonical runtime identifier: $contract" }
    }
}

function Test-RequiredFiles {
    $required = @(
        'README.md', 'SECURITY.md', 'LICENSE', 'LICENSE.txt', 'NOTICE.txt', 'THIRD_PARTY_NOTICES.md',
        'CHANGELOG.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'docs/SOURCES.md',
        'scripts/build-animated-stages.py', 'scripts/Build-Release.ps1', 'scripts/Test-Release.ps1',
        'assets/codex2007-title-bg.png', 'assets/codex2007-window-controls.png',
        'assets/codex2007-bot-typing-sprites.png', 'assets/codex2007-bot-stage.gif',
        'assets/qq-retro-stage.png', 'assets/qq-retro-wave-sprites.png', 'assets/qq-retro-stage.gif',
        'assets/qq-level-star.png', 'assets/qq-level-moon.png',
        'assets/qq-level-sun.png', 'assets/qq-level-crown.png'
    )
    foreach ($file in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)) { Add-Failure "Missing required file: $file" }
    }
}

function Test-AnimatedAssets {
    try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop }
    catch { Add-Failure "System.Drawing could not validate animated assets: $($_.Exception.Message)"; return }
    foreach ($file in @('assets/codex2007-bot-stage.gif', 'assets/qq-retro-stage.gif')) {
        $path = Join-Path $root $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $image = $null
        try {
            $image = [Drawing.Image]::FromFile($path)
            $dimension = [Drawing.Imaging.FrameDimension]::new($image.FrameDimensionsList[0])
            $frameCount = $image.GetFrameCount($dimension)
            if ($frameCount -lt 6) { Add-Failure "Animated asset has too few frames: $file ($frameCount)" }
            if ((Get-Item -LiteralPath $path).Length -gt 1.5MB) { Add-Failure "Animated asset exceeds 1.5 MB: $file" }
        }
        catch { Add-Failure "Animated asset is invalid: $file ($($_.Exception.Message))" }
        finally { if ($null -ne $image) { $image.Dispose() } }
    }
}

function Test-MarkdownLinks {
    $markdownFiles = Get-ChildItem -LiteralPath $root -Recurse -Filter '*.md' -File | Where-Object {
        $_.FullName -notmatch '[\\/]\.git[\\/]' -and $_.FullName -notmatch '[\\/]artifacts[\\/]'
    }
    foreach ($file in $markdownFiles) {
        $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        foreach ($match in [regex]::Matches($content, '\]\((?<target>[^)]+)\)')) {
            $target = $match.Groups['target'].Value.Trim().Trim('<', '>')
            if ($target -match '^(https?://|mailto:|#)' -or $target -match '^app://') { continue }
            $relative = ($target -split '#', 2)[0]
            if ([string]::IsNullOrWhiteSpace($relative)) { continue }
            $resolved = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $relative))
            if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved)) {
                Add-Failure "Broken Markdown link in $($file.FullName.Substring($root.Length + 1)): $target"
            }
        }
    }
}

function Test-NoRuntimeArtifacts {
    $forbidden = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
        $_.FullName -notmatch '[\\/]\.git[\\/]' -and (
            $_.Extension -eq '.log' -or
            $_.Name -like 'verify*.json' -or
            $_.Name -like 'watcher-ready*.json' -or
            $_.Name -eq 'state.json' -or
            $_.Name -like 'dom-*.json'
        )
    }
    foreach ($file in $forbidden) { Add-Failure "Runtime artifact must not be committed: $($file.FullName.Substring($root.Length + 1))" }
}

function Test-ApprovalOverlayProtection {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    foreach ($contract in @(
        'const hasNativeApprovalSurface = () =>',
        'if (hasNativeApprovalSurface()) return;',
        'if (hasNativeApprovalSurface()) {',
        'const nativeApprovalActive =',
        'nativeActionControlsReady',
        '&& !verified?.visualContract?.nativeApprovalActive'
    )) {
        if (-not $runtime.Contains($contract) -and -not $injector.Contains($contract)) {
            Add-Failure "Missing approval-overlay protection contract: $contract"
        }
    }
}

function Test-NativeFloatingTrayScope {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    foreach ($contract in @(
        "node.querySelectorAll('.bg-token-dropdown-background')",
        'isViewportVisible',
        'isNativeTrayExpanded',
        "card.closest('.origin-top-right')",
        'new DOMMatrixReadOnly(transform)',
        'isNativeInformationTray'
    )) {
        if (-not $runtime.Contains($contract) -or -not $injector.Contains($contract)) {
            Add-Failure "Missing native floating-tray scope contract: $contract"
        }
    }
}

function Test-SettingsHeightChain {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    $css = Get-Content -LiteralPath (Join-Path $root 'src/skin.css') -Raw -Encoding UTF8
    foreach ($contract in @(
        'qq2007SettingsColumn',
        'qq2007SettingsNavigationHost',
        'settingsNavigationFillsPane',
        'settingsNavigationContentReady',
        'settingsVisibleRowCount',
        'settingsRowsSized'
    )) {
        if (-not $runtime.Contains($contract) -and -not $injector.Contains($contract)) {
            Add-Failure "Missing settings height-chain contract: $contract"
        }
    }
    foreach ($selector in @(
        '[data-qq2007-settings-column="true"]',
        '[data-qq2007-settings-navigation-host="true"]'
    )) {
        if (-not $css.Contains($selector)) {
            Add-Failure "Missing settings height-chain selector: $selector"
        }
    }
}

function Test-SettingsSidebarHeightContract {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    if (-not $runtime.Contains("settingsContent?.closest('aside.app-shell-left-panel')")) {
        Add-Failure 'Settings sidebar must decorate the full-height app-shell aside.'
    }
    foreach ($contract in @('settingsSidebarFillsPane', "settingsSidebar?.matches('aside.app-shell-left-panel')")) {
        if (-not $injector.Contains($contract)) {
            Add-Failure "Missing settings sidebar height verification contract: $contract"
        }
    }
    foreach ($contract in @(
        'const findSettingsSearch =',
        'const isSettingsSurface = () => Boolean(findSettingsSearch())',
        'state.refreshSettingsTheme = () =>',
        'state.settingsPoller = window.setInterval'
    )) {
        if (-not $runtime.Contains($contract)) {
            Add-Failure "Missing stable settings-surface detection contract: $contract"
        }
    }
    foreach ($contract in @('preserveExistingSettings', 'preservedSettingsSurface', 'typeof state.refreshSettingsTheme')) {
        if (-not $injector.Contains($contract)) {
            Add-Failure "Missing settings re-bootstrap protection contract: $contract"
        }
    }
}

function Test-ClassicMessageActionsContract {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    $css = Get-Content -LiteralPath (Join-Path $root 'src/skin.css') -Raw -Encoding UTF8
    foreach ($contract in @(
        'makeClassicMessageActionIcon',
        'qq2007MessageAction',
        'qq2007MessageActions',
        'qq2007MessageNativeIcon'
    )) {
        if (-not $runtime.Contains($contract)) {
            Add-Failure "Missing classic message-action runtime contract: $contract"
        }
    }
    foreach ($kind in @("kind: 'copy'", "kind: 'like'", "kind: 'dislike'", "kind: 'share'")) {
        if (-not $runtime.Contains($kind)) {
            Add-Failure "Missing classic message-action kind: $kind"
        }
    }
    foreach ($contract in @(
        'findMessageActionStrip',
        'matchingButtons.length === presentations.length',
        'delete staleStrip.dataset.qq2007MessageActions'
    )) {
        if (-not $runtime.Contains($contract)) {
            Add-Failure "Missing scoped message-action strip contract: $contract"
        }
    }
    foreach ($selector in @('[data-qq2007-message-actions="true"]', 'button[data-qq2007-message-action]', '.qq2007-message-action-icon')) {
        if (-not $css.Contains($selector)) {
            Add-Failure "Missing classic message-action selector: $selector"
        }
    }
    foreach ($contract in @(
        'classicMessageActionsReady',
        'classicMessageActionCount',
        'classicMessageActionStripsScoped',
        'conversationTurnsContained',
        'visibleConversationTurnCount'
    )) {
        if (-not $injector.Contains($contract)) {
            Add-Failure "Missing classic message-action verification contract: $contract"
        }
    }
}

function Test-MainTitleSafeInsetContract {
    $runtime = Get-Content -LiteralPath (Join-Path $root 'src/skin-runtime.js') -Raw -Encoding UTF8
    $injector = Get-Content -LiteralPath (Join-Path $root 'src/injector.mjs') -Raw -Encoding UTF8
    $css = Get-Content -LiteralPath (Join-Path $root 'src/skin.css') -Raw -Encoding UTF8
    foreach ($contract in @('syncMainTitleSafeInset', 'mainRect.left - headerRect.left', '--qq2007-main-title-safe-inset')) {
        if (-not $runtime.Contains($contract) -and -not $css.Contains($contract)) {
            Add-Failure "Missing main-title safe-inset contract: $contract"
        }
    }
    foreach ($contract in @('mainTitleClearOfLeftRail', 'mainTitleIconLeft', 'mainSurfaceLeft')) {
        if (-not $injector.Contains($contract)) {
            Add-Failure "Missing main-title collision verification: $contract"
        }
    }
}

Test-JavaScriptSyntax
Test-PowerShellSyntax
Test-Manifest
Test-VersionConsistency
Test-CanonicalProductNaming
Test-RequiredFiles
Test-AnimatedAssets
Test-MarkdownLinks
Test-NoRuntimeArtifacts
Test-ApprovalOverlayProtection
Test-NativeFloatingTrayScope
Test-SettingsHeightChain
Test-SettingsSidebarHeightContract
Test-ClassicMessageActionsContract
Test-MainTitleSafeInsetContract

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'Package validation passed.' -ForegroundColor Green
exit 0
