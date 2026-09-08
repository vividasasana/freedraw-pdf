param([string]$VaultPath = $env:OBSIDIAN_TEST_VAULT)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($VaultPath)) { $VaultPath = Join-Path $projectRoot "obsidian" }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "manifest.json") | ConvertFrom-Json
$pluginId = $manifest.id
if ($pluginId -notmatch '^[a-z0-9-]+$') { throw "Invalid plugin ID." }
$requiredFiles = @("manifest.json", "main.js", "styles.css")
foreach ($file in $requiredFiles) {
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot $file) -PathType Leaf)) { throw "Missing plugin build file: $file" }
}
$communityPluginsPath = Join-Path $VaultPath ".obsidian/community-plugins.json"
$enabledPlugins = @()
if (Test-Path -LiteralPath $communityPluginsPath) {
    # Validate before writing anything; preserve malformed configuration for recovery.
    $parsed = Get-Content -Raw -LiteralPath $communityPluginsPath | ConvertFrom-Json
    $raw = (Get-Content -Raw -LiteralPath $communityPluginsPath).Trim()
    if (!$raw.StartsWith('[') -or @($parsed | Where-Object { $_ -isnot [string] }).Count -gt 0) { throw "Invalid community-plugins.json; original left unchanged." }
    $enabledPlugins = @($parsed)
}
if ($enabledPlugins -notcontains $pluginId) { $enabledPlugins += $pluginId }
$pluginDir = Join-Path $VaultPath ".obsidian/plugins/$pluginId"
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
foreach ($file in $requiredFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $pluginDir -Force }
$json = ConvertTo-Json -InputObject @($enabledPlugins | Select-Object -Unique)
[IO.File]::WriteAllText($communityPluginsPath, $json, (New-Object Text.UTF8Encoding($false)))
Write-Host "Installed $pluginId $($manifest.version) in the selected test vault."
