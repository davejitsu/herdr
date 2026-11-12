$ErrorActionPreference = 'Stop'

$sourceLayout = Join-Path $PSScriptRoot 'layouts/spaces-tree.json'
$modNames = @('spaces-tree', 'agents-tree')
$configDir = Join-Path $env:USERPROFILE '.config/herdr-app'
$layoutsDir = Join-Path $configDir 'layouts'
$modsDir = Join-Path $configDir 'mods'
$targetLayout = Join-Path $layoutsDir 'spaces-tree.json'

if (-not (Test-Path -LiteralPath $sourceLayout -PathType Leaf)) {
    throw "Layout not found: $sourceLayout"
}
foreach ($name in $modNames) {
    $sourceMod = Join-Path $PSScriptRoot "mods/$name"
    if (-not (Test-Path -LiteralPath (Join-Path $sourceMod 'main.js') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $sourceMod 'mod.json') -PathType Leaf)) {
        throw "Mod files not found in: $sourceMod"
    }
}
$herdr = Get-Command 'herdr-app' -CommandType Application -ErrorAction Stop | Select-Object -First 1

# Back up the current files before replacing them.
$existingMods = $modNames | Where-Object { Test-Path -LiteralPath (Join-Path $modsDir $_) }
if ((Test-Path -LiteralPath $targetLayout) -or $existingMods) {
    $backupDir = Join-Path $configDir ("backups/spaces-tree-{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $targetLayout) {
        $backupLayouts = Join-Path $backupDir 'layouts'
        New-Item -ItemType Directory -Path $backupLayouts -Force | Out-Null
        Copy-Item -LiteralPath $targetLayout -Destination $backupLayouts -Force
    }
    foreach ($name in $existingMods) {
        $backupMods = Join-Path $backupDir 'mods'
        New-Item -ItemType Directory -Path $backupMods -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $modsDir $name) -Destination $backupMods -Recurse -Force
    }
    Write-Host "Backup saved to: $backupDir"
}

New-Item -ItemType Directory -Path $layoutsDir, $modsDir -Force | Out-Null
Copy-Item -LiteralPath $sourceLayout -Destination $targetLayout -Force
foreach ($name in $modNames) {
    $targetMod = Join-Path $modsDir $name
    New-Item -ItemType Directory -Path $targetMod -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "mods/$name") -Force | Copy-Item -Destination $targetMod -Recurse -Force
}

# herdr-app.exe is a GUI program. PowerShell does not wait for it and does not set
# $LASTEXITCODE, so run it with Start-Process and read the exit code from the process.
function Invoke-Herdr {
    param([string[]]$Arguments)
    $outFile = New-TemporaryFile
    $errFile = New-TemporaryFile
    try {
        $process = Start-Process -FilePath $herdr.Source -ArgumentList $Arguments `
            -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $outFile.FullName -RedirectStandardError $errFile.FullName
        Get-Content -LiteralPath $outFile.FullName, $errFile.FullName | Where-Object { $_ } | Write-Host
        return $process.ExitCode
    }
    finally {
        Remove-Item -LiteralPath $outFile.FullName, $errFile.FullName -Force -ErrorAction SilentlyContinue
    }
}

foreach ($name in $modNames) {
    $exitCode = Invoke-Herdr @('check', "`"$(Join-Path $modsDir $name)`"")
    if ($exitCode -ne 0) {
        throw "Mod check failed for $name with exit code $exitCode. The layout was not selected."
    }
}
$exitCode = Invoke-Herdr @('do', 'layout.switch', '--name', 'spaces-tree')
if ($exitCode -ne 0) {
    throw "Layout switch failed with exit code $exitCode."
}
Write-Host 'Spaces Tree was updated and selected.'
