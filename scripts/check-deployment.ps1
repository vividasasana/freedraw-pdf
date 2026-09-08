$ErrorActionPreference = 'Stop'
$reviewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureRoot = Join-Path $reviewRoot ('.analysis/deployment-test-' + [Guid]::NewGuid().ToString('N'))
$savedCloudRoot = $env:OneDrive
$savedCloudVault = $env:OBSIDIAN_ONEDRIVE_VAULT
try {
    New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
    $env:OneDrive = Join-Path $fixtureRoot 'cloud'
    $env:OBSIDIAN_ONEDRIVE_VAULT = Join-Path $env:OneDrive 'destination'
    New-Item -ItemType Directory -Force -Path $env:OneDrive | Out-Null
    foreach ($version in @('plugin')) {
        $fixtureProject = Join-Path $fixtureRoot $version
        $fixtureScripts = Join-Path $fixtureProject 'scripts'
        $fixtureVault = Join-Path $fixtureRoot ($version + '-vault')
        $fixturePlugin = Join-Path $fixtureVault '.obsidian/plugins/freedraw-pdf'
        New-Item -ItemType Directory -Force -Path $fixtureScripts,$fixturePlugin | Out-Null
        Copy-Item -LiteralPath (Join-Path $reviewRoot 'scripts/deploy-test.ps1') -Destination $fixtureScripts
        $fixtureScript = Join-Path $fixtureScripts 'deploy-test.ps1'
        Set-Content -LiteralPath (Join-Path $fixtureProject 'manifest.json') -Value '{"id":"freedraw-pdf","version":"0.0.0"}'
        Set-Content -LiteralPath (Join-Path $fixtureProject 'main.js') -Value '// fixture build'
        Set-Content -LiteralPath (Join-Path $fixtureProject 'styles.css') -Value '/* fixture styles */'
        $fixtureConfig = Join-Path $fixtureVault '.obsidian/community-plugins.json'
        Set-Content -LiteralPath $fixtureConfig -Value '["other-plugin"]'
        $fixtureSettings = Join-Path $fixturePlugin 'data.json'
        Set-Content -LiteralPath $fixtureSettings -Value '{"preserve":true}'
        $fixtureNote = Join-Path $fixtureVault 'private-note.md'
        Set-Content -LiteralPath $fixtureNote -Value 'Do not copy this test note.'
        $noteHash = (Get-FileHash -LiteralPath $fixtureNote).Hash
        $settingsHash = (Get-FileHash -LiteralPath $fixtureSettings).Hash
        & $fixtureScript -VaultPath $fixtureVault
        foreach ($asset in @('manifest.json', 'main.js', 'styles.css')) {
            if ((Get-FileHash -LiteralPath (Join-Path $fixtureProject $asset)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $fixturePlugin $asset)).Hash) { throw 'Installed asset mismatch.' }
        }
        $plugins = Get-Content -Raw -LiteralPath $fixtureConfig | ConvertFrom-Json
        if ($plugins.Count -ne 2 -or $plugins -notcontains 'other-plugin' -or $plugins -notcontains 'freedraw-pdf') { throw 'Existing plugin list was not preserved.' }
        if ($noteHash -ne (Get-FileHash -LiteralPath $fixtureNote).Hash -or $settingsHash -ne (Get-FileHash -LiteralPath $fixtureSettings).Hash) { throw 'Deployment changed unrelated user content.' }
        if (@(Get-ChildItem -LiteralPath $env:OneDrive -Force).Count -ne 0) { throw 'Deployment copied content into the cloud destination.' }
        foreach ($invalidJson in @('{ broken', '{}', '[null]', '[123]')) {
            Set-Content -LiteralPath $fixtureConfig -Value $invalidJson
            $configHash = (Get-FileHash -LiteralPath $fixtureConfig).Hash
            $rejected = $false
            try { & $fixtureScript -VaultPath $fixtureVault } catch { $rejected = $true }
            if (!$rejected -or $configHash -ne (Get-FileHash -LiteralPath $fixtureConfig).Hash) { throw 'Malformed configuration was not preserved and rejected.' }
        }
    }
    Write-Output 'Deployment privacy passed: plugin assets only, no cloud copy, notes/settings/plugin lists preserved, malformed configuration rejected.'
} finally {
    $env:OneDrive = $savedCloudRoot
    $env:OBSIDIAN_ONEDRIVE_VAULT = $savedCloudVault
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $allowedFixtureParent = [IO.Path]::GetFullPath((Join-Path $reviewRoot '.analysis'))
    if (!$resolvedFixture.StartsWith($allowedFixtureParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid cleanup boundary.' }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
