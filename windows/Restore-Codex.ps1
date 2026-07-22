#requires -Version 5.1

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    $legacy = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $legacy -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
    exit $LASTEXITCODE
}

. (Join-Path $PSScriptRoot 'Common.ps1')

try {
    $state = Read-QQState
    if ($null -eq $state) {
        Write-Host '未发现活动的 Codex 2007 主题状态；未修改 Codex。'
        exit 0
    }

    $packageRoot = Get-QQPackageRoot
    $expectedInjector = Join-Path $packageRoot 'src\injector.mjs'
    if (-not (Test-QQSamePath -Left ([string]$state.injectorPath) -Right $expectedInjector)) {
        throw '主题状态与当前安装包不匹配，未执行进程操作。'
    }
    $port = [int]$state.port
    if ($port -lt 1024 -or $port -gt 65535) { throw '状态中的端口无效。' }
    $codex = Get-QQCodexInstall
    $node = (Get-Command node.exe -ErrorAction Stop).Source

    $endpoint = Get-QQVerifiedEndpoint -Port $port -Codex $codex
    if ($null -ne $endpoint) {
        & $node $expectedInjector remove --port $port --output (Join-Path $script:QQRuntimeRoot 'restore.json')
        if ($LASTEXITCODE -ne 0) { throw '页面皮肤清理未通过。' }
    }

    Stop-QQWatcherSafely -State $state -ExpectedInjector $expectedInjector | Out-Null

    $themed = @(Get-QQCodexProcesses -Codex $codex | Where-Object {
        $_.CommandLine -match "--remote-debugging-port=$port(?:\s|$)" -or
        $_.CommandLine -match [regex]::Escape([string]$state.profileAlias)
    })
    if ($themed.Count -gt 0) {
        Stop-QQCodexProcesses -Codex $codex -Processes $themed
        Start-QQCodexPackage -Codex $codex | Out-Null
    }
    Remove-QQProfileAliasSafely -Alias ([string]$state.profileAlias) -ExpectedTarget ([string]$state.profileTarget)

    Remove-Item -LiteralPath (Join-Path $script:QQRuntimeRoot 'watcher-ready.json') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:QQStatePath -Force -ErrorAction Stop
    Write-Host '已恢复官方 Codex 外观，并关闭主题调试接口。' -ForegroundColor Green
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
