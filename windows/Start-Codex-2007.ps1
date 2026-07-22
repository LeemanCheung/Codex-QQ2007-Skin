#requires -Version 5.1

param(
    [ValidateRange(1024, 65515)][int]$PreferredPort = 9349
)

$forward = @('-PreferredPort', [string]$PreferredPort)
if ($PSVersionTable.PSEdition -ne 'Desktop') {
    $legacy = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $legacy -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @forward
    exit $LASTEXITCODE
}

. (Join-Path $PSScriptRoot 'Common.ps1')

$packageRoot = Get-QQPackageRoot
$injector = Join-Path $packageRoot 'src\injector.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$readyFile = Join-Path $script:QQRuntimeRoot 'watcher-ready.json'
$verifyFile = Join-Path $script:QQRuntimeRoot 'verify.json'
$domInspectFile = Join-Path $script:QQRuntimeRoot 'dom-before-theme.json'
$watcher = $null
$codex = $null
$launchedThemeCodex = $false

try {
    if (-not (Test-Path -LiteralPath $injector -PathType Leaf)) { throw '主题注入器文件不存在。' }
    New-Item -ItemType Directory -Force -Path $script:QQRuntimeRoot | Out-Null

    $oldState = Read-QQState
    if ($null -ne $oldState) {
        Stop-QQWatcherSafely -State $oldState -ExpectedInjector ([string]$oldState.injectorPath) | Out-Null
    }

    $codex = Get-QQCodexInstall
    $running = @(Get-QQCodexProcesses -Codex $codex)
    if ($running.Count -gt 0) { Stop-QQCodexProcesses -Codex $codex -Processes $running }

    $port = Get-QQFreePort -PreferredPort $PreferredPort
    $profile = Ensure-QQProfileAlias
    Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $verifyFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $domInspectFile -Force -ErrorAction SilentlyContinue

    $launchPid = Start-QQCodexPackage -Codex $codex -Arguments @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$port",
        "--user-data-dir=$($profile.Alias)"
    )
    $launchedThemeCodex = $true
    $endpoint = Wait-QQVerifiedEndpoint -Port $port -Codex $codex -TimeoutSeconds 60

    $domDeadline = (Get-Date).AddSeconds(60)
    $nativeDomReady = $false
    do {
        & $node $injector inspect --port $port --output $domInspectFile
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $domInspectFile -PathType Leaf)) {
            $domInspection = Get-Content -LiteralPath $domInspectFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $nativeDomReady = (
                [int]$domInspection.selectors.root -ge 1 -and
                [int]$domInspection.selectors.leftPanel -ge 1 -and
                [int]$domInspection.selectors.mainSurface -ge 1 -and
                [int]$domInspection.selectors.composer -ge 1
            )
        }
        if (-not $nativeDomReady) { Start-Sleep -Milliseconds 300 }
    } while (-not $nativeDomReady -and (Get-Date) -lt $domDeadline)
    if (-not $nativeDomReady) {
        throw 'Codex 原生 DOM 未在 60 秒内完整挂载；已保留 dom-before-theme.json 供排查。'
    }

    $watcher = Start-QQWatcher -NodePath $node -InjectorPath $injector -Port $port -ReadyFile $readyFile
    $deadline = (Get-Date).AddSeconds(60)
    do {
        if ($watcher.HasExited) { throw '主题监视进程提前退出，请查看运行日志。' }
        if (Test-Path -LiteralPath $readyFile -PathType Leaf) { break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if (-not (Test-Path -LiteralPath $readyFile -PathType Leaf)) { throw '主题监视进程未在 60 秒内就绪。' }
    $ready = Get-Content -LiteralPath $readyFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $ready.pass -or -not $ready.applied.pass) { throw '主题监视进程未确认皮肤已应用。' }

    & $node $injector verify --port $port --output $verifyFile
    if ($LASTEXITCODE -ne 0) { throw '主题布局验收未通过。' }
    $verification = Get-Content -LiteralPath $verifyFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $verification.pass -or -not $verification.nativeAppIntact) {
        throw '主题未能同时满足布局完整与原生功能保留。'
    }

    Write-QQState -State ([ordered]@{
        schemaVersion = 1
        product = $script:QQProductName
        version = $script:QQVersion
        port = $port
        watcherPid = $watcher.Id
        watcherStartedAt = $watcher.StartTime.ToUniversalTime().ToString('o')
        injectorPath = [IO.Path]::GetFullPath($injector)
        nodePath = [IO.Path]::GetFullPath($node)
        profileAlias = $profile.Alias
        profileTarget = $profile.Target
        codexExecutable = $codex.Executable
        codexPackageFullName = $codex.PackageFullName
        codexAppUserModelId = $codex.AppUserModelId
        codexLaunchPid = $launchPid
        targetId = $endpoint.TargetId
        verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    })

    Write-Host "Codex 2007 已启动并通过验证。" -ForegroundColor Green
    Write-Host "QQ等级由本机累计 Token 统计自动计算；主题接口仅监听 127.0.0.1:$port。"
    exit 0
}
catch {
    if ($null -ne $watcher -and -not $watcher.HasExited) {
        Stop-Process -Id $watcher.Id -ErrorAction SilentlyContinue
    }
    if ($launchedThemeCodex -and $null -ne $codex) {
        $themed = @(Get-QQCodexProcesses -Codex $codex | Where-Object {
            $_.CommandLine -match '--remote-debugging-port=' -or $_.CommandLine -match 'CodexProfileAlias'
        })
        if ($themed.Count -gt 0) { Stop-QQCodexProcesses -Codex $codex -Processes $themed }
        try { Start-QQCodexPackage -Codex $codex | Out-Null } catch {}
    }
    Write-Error $_.Exception.Message
    exit 1
}
