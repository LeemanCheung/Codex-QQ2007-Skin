#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$archive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw "发布包不存在：$archive"
}
$checksumPath = "$archive.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
    throw "发布包校验文件不存在：$checksumPath"
}

$archiveDirectory = Split-Path -Parent $archive
$verificationRoot = Join-Path $archiveDirectory ('.verify-' + [Guid]::NewGuid().ToString('N'))
$verificationRoot = [IO.Path]::GetFullPath($verificationRoot)
$safePrefix = [IO.Path]::GetFullPath($archiveDirectory).TrimEnd('\') + '\'
if (-not $verificationRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝使用发布目录之外的验证路径：$verificationRoot"
}

try {
    $expectedArchiveHash = ((Get-Content -LiteralPath $checksumPath -Raw -Encoding UTF8).Trim() -split '\s+')[0]
    $actualArchiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualArchiveHash -ne $expectedArchiveHash) {
        throw '发布 ZIP 的 SHA-256 与同名校验文件不一致。'
    }

    New-Item -ItemType Directory -Path $verificationRoot | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $verificationRoot
    $packageName = [IO.Path]::GetFileNameWithoutExtension($archive)
    $packageRoot = Join-Path $verificationRoot $packageName
    if (-not (Test-Path -LiteralPath $packageRoot -PathType Container)) {
        throw "ZIP 中缺少唯一包根目录：$packageName"
    }

    $packageChecksumPath = Join-Path $packageRoot 'PACKAGE-SHA256SUMS'
    if (-not (Test-Path -LiteralPath $packageChecksumPath -PathType Leaf)) {
        throw 'ZIP 中缺少 PACKAGE-SHA256SUMS。'
    }
    $verifiedFiles = 0
    foreach ($line in Get-Content -LiteralPath $packageChecksumPath -Encoding UTF8) {
        if ($line -notmatch '^([0-9a-f]{64})  (.+)$') {
            throw "内部校验行格式无效：$line"
        }
        $expected = $Matches[1]
        $relativePath = $Matches[2]
        $file = [IO.Path]::GetFullPath((Join-Path $packageRoot $relativePath))
        $packagePrefix = [IO.Path]::GetFullPath($packageRoot).TrimEnd('\') + '\'
        if (-not $file.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "内部校验路径越界：$relativePath"
        }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "内部校验文件缺失：$relativePath"
        }
        $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "内部文件校验失败：$relativePath"
        }
        $verifiedFiles += 1
    }

    $manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($packageName -ne "Codex-2007-v$($manifest.version)") {
        throw "ZIP 名称与 manifest 版本不一致：$packageName / $($manifest.version)"
    }
    foreach ($entrypoint in $manifest.entrypoints.PSObject.Properties) {
        if (-not (Test-Path -LiteralPath (Join-Path $packageRoot ([string]$entrypoint.Value)) -PathType Leaf)) {
            throw "发布包缺少入口：$($entrypoint.Value)"
        }
    }

    $forbidden = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Where-Object {
        $_.FullName -match '[\/](\.git|\.github|artifacts|runtime)[\/]' -or
        $_.Extension -eq '.log' -or
        $_.Name -like 'verify*.json' -or
        $_.Name -like 'watcher-ready*.json' -or
        $_.Name -eq 'state.json' -or
        $_.Name -like 'dom-*.json'
    })
    if ($forbidden.Count -gt 0) {
        throw "发布包包含禁止文件：$($forbidden[0].FullName)"
    }

    [PSCustomObject]@{
        version = [string]$manifest.version
        archive = $archive
        sha256 = $actualArchiveHash
        verifiedFiles = $verifiedFiles
        entrypoints = @($manifest.entrypoints.PSObject.Properties).Count
        forbiddenFiles = $forbidden.Count
    } | ConvertTo-Json
}
finally {
    if (Test-Path -LiteralPath $verificationRoot) {
        Remove-Item -LiteralPath $verificationRoot -Recurse -Force
    }
}
