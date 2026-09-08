$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$pluginId = $manifest.id
$version = $manifest.version
$distDir = Join-Path $projectRoot "dist"
$packagePath = Join-Path $distDir "$pluginId-$version.zip"
$requiredFiles = @("manifest.json", "main.js", "styles.css")

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

foreach ($file in $requiredFiles) {
	$source = Join-Path $projectRoot $file
	if (!(Test-Path -LiteralPath $source)) {
		throw "Missing package file: $source"
	}
}

if (Test-Path -LiteralPath $packagePath) {
	Remove-Item -LiteralPath $packagePath -Force
}

$sourceFiles = $requiredFiles | ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $sourceFiles -DestinationPath $packagePath -Force

Write-Host "Packaged $pluginId $version to $packagePath"
