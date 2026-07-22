#requires -Version 5.1

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:QQProductName = 'Codex 2007'
$script:QQVersion = '1.2.0'
$script:QQStateRoot = Join-Path $env:LOCALAPPDATA 'Codex2007'
$script:QQRuntimeRoot = Join-Path $script:QQStateRoot 'runtime'
$script:QQStatePath = Join-Path $script:QQRuntimeRoot 'state.json'

function Test-QQSamePath {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )
    try {
        $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd('\')
        $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd('\')
        return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

function Test-QQChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    try {
        $candidatePath = [IO.Path]::GetFullPath($Candidate)
        $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
        return $candidatePath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

function Get-QQPackageRoot {
    return [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
}

function Get-QQCodexInstall {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($null -eq $package) { throw '未检测到官方 OpenAI Codex Windows 应用。' }

    $manifest = Get-AppxPackageManifest -Package $package -ErrorAction Stop
    $applications = @($manifest.Package.Applications.Application)
    if ($applications.Count -ne 1 -or -not $applications[0].Id) {
        throw '无法唯一确定官方 Codex 应用入口。'
    }

    $executable = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw '官方 Codex 可执行文件不存在。'
    }

    $appUserModelId = "$($package.PackageFamilyName)!$($applications[0].Id)"
    if ($appUserModelId -cnotmatch '^[A-Za-z0-9._-]{1,128}![A-Za-z0-9._-]{1,64}$') {
        throw '官方 Codex 应用标识校验失败。'
    }

    return [pscustomobject]@{
        PackageFullName = [string]$package.PackageFullName
        PackageFamilyName = [string]$package.PackageFamilyName
        InstallLocation = [IO.Path]::GetFullPath([string]$package.InstallLocation)
        Executable = [IO.Path]::GetFullPath($executable)
        Version = [string]$package.Version
        AppUserModelId = $appUserModelId
    }
}

function Initialize-QQPackageLauncher {
    if ('Codex2007.PackageLauncher' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Codex2007 {
  [Flags]
  internal enum ActivateOptions : uint { None = 0 }

  [ComImport]
  [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication(
      [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
      [MarshalAs(UnmanagedType.LPWStr)] string arguments,
      ActivateOptions options,
      out uint processId);
  }

  [ComImport]
  [Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")]
  internal class ApplicationActivationManager {}

  public static class PackageLauncher {
    public static uint Launch(string appUserModelId, string arguments) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      try {
        uint processId;
        int result = manager.ActivateApplication(
          appUserModelId,
          arguments ?? string.Empty,
          ActivateOptions.None,
          out processId);
        Marshal.ThrowExceptionForHR(result);
        return processId;
      } finally {
        if (Marshal.IsComObject(manager)) Marshal.FinalReleaseComObject(manager);
      }
    }
  }
}
'@
}

function Start-QQCodexPackage {
    param(
        [Parameter(Mandatory = $true)][object]$Codex,
        [string[]]$Arguments = @()
    )
    Initialize-QQPackageLauncher
    foreach ($argument in $Arguments) {
        if ($argument.Contains('"')) { throw 'Codex 启动参数包含不允许的双引号。' }
    }
    $argumentLine = ($Arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' '
    $processId = [Codex2007.PackageLauncher]::Launch($Codex.AppUserModelId, $argumentLine)
    if ($processId -le 0) { throw 'Windows 未返回有效的 Codex 进程号。' }
    return [int]$processId
}

function Get-QQCodexProcesses {
    param([Parameter(Mandatory = $true)][object]$Codex)
    $items = @()
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue)) {
        $processPath = [string]$process.ExecutablePath
        if (-not $processPath) {
            try { $processPath = [string](Get-Process -Id $process.ProcessId -ErrorAction Stop).Path }
            catch { continue }
        }
        if (Test-QQSamePath -Left $processPath -Right $Codex.Executable) {
            $items += [pscustomobject]@{
                ProcessId = [int]$process.ProcessId
                ExecutablePath = [IO.Path]::GetFullPath($processPath)
                CommandLine = [string]$process.CommandLine
            }
        }
    }
    return @($items)
}

function Stop-QQCodexProcesses {
    param(
        [Parameter(Mandatory = $true)][object]$Codex,
        [AllowEmptyCollection()][object[]]$Processes = @()
    )
    if ($Processes.Count -eq 0) { $Processes = @(Get-QQCodexProcesses -Codex $Codex) }
    $processIds = @($Processes | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    foreach ($processId in $processIds) {
        Stop-Process -Id $processId -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(8)
    do {
        $remaining = @($processIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($remaining.Count -eq 0) { return }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    foreach ($processId in $remaining) {
        $current = Get-QQCodexProcesses -Codex $Codex | Where-Object { $_.ProcessId -eq $processId }
        if ($current) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    }
}

function Get-QQFreePort {
    param([int]$PreferredPort = 9349)
    if ($PreferredPort -lt 1024 -or $PreferredPort -gt 65515) { throw '调试端口不在允许范围。' }
    for ($port = $PreferredPort; $port -le [Math]::Min(65535, $PreferredPort + 20); $port++) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) { return $port }
    }
    throw '未找到可用的本机回环端口。'
}

function Get-QQVerifiedEndpoint {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][object]$Codex
    )
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    foreach ($listener in $listeners) {
        if ([string]$listener.LocalAddress -notin @('127.0.0.1', '::1')) { return $null }
        $owner = Get-QQCodexProcesses -Codex $Codex | Where-Object { $_.ProcessId -eq [int]$listener.OwningProcess }
        if ($null -eq $owner) { return $null }
    }
    try {
        $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 -MaximumRedirection 0)
        $target = $targets | Where-Object {
            $_.type -ceq 'page' -and $_.url -ceq 'app://-/index.html' -and
            [string]$_.id -cmatch '^[A-Za-z0-9._-]+$' -and
            [string]$_.webSocketDebuggerUrl -cmatch "^ws://(?:127\.0\.0\.1|localhost|\[::1\]):$Port/devtools/page/[A-Za-z0-9._-]+$"
        } | Select-Object -First 1
        if ($null -eq $target) { return $null }
        return [pscustomobject]@{ TargetId = [string]$target.id; Port = $Port }
    }
    catch { return $null }
}

function Wait-QQVerifiedEndpoint {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][object]$Codex,
        [int]$TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $endpoint = Get-QQVerifiedEndpoint -Port $Port -Codex $Codex
        if ($null -ne $endpoint) { return $endpoint }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)
    throw "Codex 未在 $TimeoutSeconds 秒内提供经过校验的本机主题接口。"
}

function Ensure-QQProfileAlias {
    New-Item -ItemType Directory -Force -Path $script:QQRuntimeRoot | Out-Null
    $target = Join-Path $env:APPDATA 'Codex\web\Codex'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $alias = Join-Path $script:QQRuntimeRoot 'CodexProfileAlias'
    if (Test-Path -LiteralPath $alias) {
        $item = Get-Item -LiteralPath $alias -Force
        $targets = @($item.Target)
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            $item.LinkType -ne 'Junction' -or $targets.Count -ne 1 -or
            -not (Test-QQSamePath -Left ([string]$targets[0]) -Right $target)) {
            throw '现有主题 ProfileAlias 不是指向 Codex 用户数据目录的安全目录联接，已停止。'
        }
        return [pscustomobject]@{ Alias = [IO.Path]::GetFullPath($alias); Target = [IO.Path]::GetFullPath($target) }
    }
    $junction = New-Item -ItemType Junction -Path $alias -Target $target
    return [pscustomobject]@{ Alias = [IO.Path]::GetFullPath($junction.FullName); Target = [IO.Path]::GetFullPath($target) }
}

function ConvertTo-QQProcessArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value.Contains('"')) { throw '子进程参数包含不允许的双引号。' }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

function Start-QQWatcher {
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$InjectorPath,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ReadyFile
    )
    $stdout = Join-Path $script:QQRuntimeRoot 'watcher.out.log'
    $stderr = Join-Path $script:QQRuntimeRoot 'watcher.err.log'
    $arguments = @($InjectorPath, 'watch', '--port', [string]$Port, '--enable', '--ready-file', $ReadyFile)
    $argumentLine = ($arguments | ForEach-Object { ConvertTo-QQProcessArgument -Value $_ }) -join ' '
    return Start-Process -FilePath $NodePath -ArgumentList $argumentLine -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Write-QQState {
    param([Parameter(Mandatory = $true)][object]$State)
    New-Item -ItemType Directory -Force -Path $script:QQRuntimeRoot | Out-Null
    $temporary = Join-Path $script:QQRuntimeRoot ("state-{0}.tmp" -f [guid]::NewGuid().ToString('N'))
    $json = $State | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $script:QQStatePath -Force
}

function Read-QQState {
    if (-not (Test-Path -LiteralPath $script:QQStatePath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $script:QQStatePath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw '主题状态文件损坏，未执行进程操作。' }
}

function Stop-QQWatcherSafely {
    param(
        [AllowNull()][object]$State,
        [Parameter(Mandatory = $true)][string]$ExpectedInjector
    )
    if ($null -eq $State -or -not $State.watcherPid) { return $true }
    if (-not (Test-QQChildPath -Candidate ([string]$State.injectorPath) -Parent $script:QQStateRoot) -or
        -not (Test-QQSamePath -Left ([string]$State.injectorPath) -Right $ExpectedInjector)) {
        throw '状态中的注入器路径未通过安全校验，未停止任何进程。'
    }
    $processId = [int]$State.watcherPid
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $true }
    $nodePath = [string]$process.ExecutablePath
    if (-not $nodePath) {
        try { $nodePath = [string](Get-Process -Id $processId -ErrorAction Stop).Path }
        catch { throw '无法验证主题监视进程，未停止。' }
    }
    if (-not (Test-QQSamePath -Left $nodePath -Right ([string]$State.nodePath)) -or
        [string]$process.CommandLine -notmatch [regex]::Escape([string]$State.injectorPath) -or
        [string]$process.CommandLine -notmatch "--port\s+$([int]$State.port)(?:\s|$)") {
        throw '主题监视进程身份校验失败，未停止。'
    }
    Stop-Process -Id $processId -ErrorAction Stop
    return $true
}

function Remove-QQProfileAliasSafely {
    param(
        [Parameter(Mandatory = $true)][string]$Alias,
        [Parameter(Mandatory = $true)][string]$ExpectedTarget
    )
    if (-not (Test-Path -LiteralPath $Alias)) { return }
    if (-not (Test-QQChildPath -Candidate $Alias -Parent $script:QQRuntimeRoot)) {
        throw 'ProfileAlias 不在主题运行目录内，未移除。'
    }
    $item = Get-Item -LiteralPath $Alias -Force
    $targets = @($item.Target)
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $item.LinkType -ne 'Junction' -or $targets.Count -ne 1 -or
        -not (Test-QQSamePath -Left ([string]$targets[0]) -Right $ExpectedTarget)) {
        throw 'ProfileAlias 联接目标不匹配，未移除。'
    }
    Remove-Item -LiteralPath $Alias -Force
}

function Invoke-QQInWindowsPowerShellIfNeeded {
    param([string[]]$ForwardArguments = @())
    if ($PSVersionTable.PSEdition -eq 'Desktop') { return $false }
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath) + $ForwardArguments
    & $windowsPowerShell @arguments
    exit $LASTEXITCODE
}
