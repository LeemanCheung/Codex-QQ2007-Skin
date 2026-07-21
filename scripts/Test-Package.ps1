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
        [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        foreach ($parseError in @($errors)) {
            Add-Failure "PowerShell syntax failed: $($file.FullName.Substring($root.Length + 1)): $($parseError.Message)"
        }
    }
}

function Test-Manifest {
    try { $manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Add-Failure "manifest.json is invalid: $($_.Exception.Message)"; return }
    if ($manifest.version -ne '1.0.0') { Add-Failure 'manifest version must remain 1.0.0 for this release.' }
    foreach ($property in $manifest.entrypoints.PSObject.Properties) {
        $path = Join-Path $root ([string]$property.Value)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Add-Failure "Missing entrypoint: $($property.Value)" }
    }
    foreach ($asset in @($manifest.thirdPartyAssets)) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $asset) -PathType Leaf)) { Add-Failure "Missing declared third-party asset: $asset" }
    }
}

function Test-RequiredFiles {
    $required = @(
        'README.md', 'SECURITY.md', 'LICENSE.txt', 'NOTICE.txt', 'THIRD_PARTY_NOTICES.md',
        'CHANGELOG.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'docs/SOURCES.md',
        'assets/codex2007-title-bg.png', 'assets/codex2007-window-controls.png',
        'assets/qq-level-star.png', 'assets/qq-level-moon.png',
        'assets/qq-level-sun.png', 'assets/qq-level-crown.png'
    )
    foreach ($file in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)) { Add-Failure "Missing required file: $file" }
    }
}

function Test-MarkdownLinks {
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Filter '*.md' -File) {
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

Test-JavaScriptSyntax
Test-PowerShellSyntax
Test-Manifest
Test-RequiredFiles
Test-MarkdownLinks
Test-NoRuntimeArtifacts

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'Package validation passed.' -ForegroundColor Green
exit 0
