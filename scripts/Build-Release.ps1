#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutputDirectory = 'artifacts\release'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "manifest.json 中的版本号无效：$version"
}

$outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
    [IO.Path]::GetFullPath($OutputDirectory)
}
else {
    [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
}
$archiveName = "Codex-2007-v$version"
$stagingRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot $archiveName))
$archivePath = [IO.Path]::GetFullPath((Join-Path $outputRoot "$archiveName.zip"))
$archiveChecksumPath = "$archivePath.sha256"

function Assert-ChildPath([string]$Parent, [string]$Child) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $childFull = [IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝操作输出目录之外的路径：$childFull"
    }
}

Assert-ChildPath $outputRoot $stagingRoot
Assert-ChildPath $outputRoot $archivePath
Assert-ChildPath $outputRoot $archiveChecksumPath
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
foreach ($target in @($stagingRoot, $archivePath, $archiveChecksumPath)) {
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

$files = @(
    'README.md', 'SECURITY.md', 'LICENSE.txt', 'NOTICE.txt',
    'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'manifest.json',
    'docs/INSTALLATION.md', 'docs/USAGE.md', 'docs/ARCHITECTURE.md',
    'docs/TROUBLESHOOTING.md', 'docs/COMPATIBILITY.md', 'docs/VERIFICATION.md',
    'docs/PRIVACY.md', 'docs/SOURCES.md',
    'src/injector.mjs', 'src/token-stats.mjs', 'src/skin-runtime.js', 'src/skin.css',
    'windows/Common.ps1', 'windows/Start-Codex-2007.ps1',
    'windows/Restore-Codex.ps1', 'windows/Install-Codex-2007.ps1',
    'assets/codex2007-title-bg.png', 'assets/codex2007-toolbar-bg.png',
    'assets/codex2007-panel-header-bg.png', 'assets/codex2007-status-bg.png',
    'assets/codex2007-window-controls.png', 'assets/codex2007-penguin.png',
    'assets/codex2007-tool-new.png', 'assets/codex2007-tool-scheduled.png',
    'assets/codex2007-tool-plugins.png', 'assets/codex2007-tool-sites.png',
    'assets/codex2007-tool-pr.png', 'assets/codex2007-tool-chat.png',
    'assets/codex2007-bot-stage.png', 'assets/codex2007-bot-stage.gif',
    'assets/qq-retro-stage.png', 'assets/qq-retro-stage.gif',
    'assets/codex2007-friend-stage.png', 'assets/codex2007-status-icons.png',
    'assets/codex2007-shield.png', 'assets/codex2007-signal.png',
    'assets/codex2007-flower.png', 'assets/codex2007-composer-emoji.png',
    'assets/codex2007-composer-image.png', 'assets/codex2007-composer-attach.png',
    'assets/codex2007-send.png', 'assets/codex2007-online.png',
    'assets/codex2007-panel-tools.png', 'assets/codex2007-caret.png',
    'assets/codex2007-right-controls.png', 'assets/codex2007-search.png',
    'assets/codex2007-folder.png', 'assets/qq-level-star.png',
    'assets/qq-level-moon.png', 'assets/qq-level-sun.png',
    'assets/qq-level-crown.png', 'assets/QQ_LEVEL_ICON_SOURCE.md',
    'assets/readme/hero.svg', 'assets/readme/workflow.svg'
)

foreach ($relativePath in $files) {
    $source = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "发布包缺少白名单文件：$relativePath"
    }
    $destination = Join-Path $stagingRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

$packageChecksums = foreach ($relativePath in $files | Sort-Object) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $stagingRoot $relativePath) -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $hash, ($relativePath -replace '\\', '/')
}
[IO.File]::WriteAllText(
    (Join-Path $stagingRoot 'PACKAGE-SHA256SUMS'),
    (($packageChecksums -join "`n") + "`n"),
    [Text.UTF8Encoding]::new($false)
)

Compress-Archive -LiteralPath $stagingRoot -DestinationPath $archivePath -CompressionLevel Optimal
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
    $archiveChecksumPath,
    ("$archiveHash  $([IO.Path]::GetFileName($archivePath))`n"),
    [Text.UTF8Encoding]::new($false)
)

[PSCustomObject]@{
    version = $version
    archive = $archivePath
    checksum = $archiveChecksumPath
    sha256 = $archiveHash
    fileCount = $files.Count + 1
    bytes = (Get-Item -LiteralPath $archivePath).Length
} | ConvertTo-Json
