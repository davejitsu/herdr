$ErrorActionPreference = 'Stop'

$sourceLayout = Join-Path $PSScriptRoot 'layouts/spaces-tree.json'
$sourceMod = Join-Path $PSScriptRoot 'mods/spaces-tree'
$configDir = Join-Path $env:USERPROFILE '.config/herdr-app'
$layoutsDir = Join-Path $configDir 'layouts'
$modsDir = Join-Path $configDir 'mods'
$targetLayout = Join-Path $layoutsDir 'spaces-tree.json'
$targetMod = Join-Path $modsDir 'spaces-tree'

if (-not (Test-Path -LiteralPath $sourceLayout -PathType Leaf)) {
    throw "Layout not found: $sourceLayout"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceMod 'main.js') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $sourceMod 'mod.json') -PathType Leaf)) {
    throw "Mod files not found in: $sourceMod"
}
$herdr = Get-Command 'herdr-app' -CommandType Application -ErrorAction Stop | Select-Object -First 1

# Back up the current files before replacing them.
if ((Test-Path -LiteralPath $targetLayout) -or (Test-Path -LiteralPath $targetMod)) {
    $backupDir = Join-Path $configDir ("backups/spaces-tree-{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $targetLayout) {
        $backupLayouts = Join-Path $backupDir 'layouts'
        New-Item -ItemType Directory -Path $backupLayouts -Force | Out-Null
        Copy-Item -LiteralPath $targetLayout -Destination $backupLayouts -Force
    }
    if (Test-Path -LiteralPath $targetMod) {
        $backupMods = Join-Path $backupDir 'mods'
        New-Item -ItemType Directory -Path $backupMods -Force | Out-Null
        Copy-Item -LiteralPath $targetMod -Destination $backupMods -Recurse -Force
    }
    Write-Host "Backup saved to: $backupDir"
}

New-Item -ItemType Directory -Path $layoutsDir, $modsDir -Force | Out-Null
Copy-Item -LiteralPath $sourceLayout -Destination $targetLayout -Force
New-Item -ItemType Directory -Path $targetMod -Force | Out-Null
Get-ChildItem -LiteralPath $sourceMod -Force | Copy-Item -Destination $targetMod -Recurse -Force

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

$exitCode = Invoke-Herdr @('check', "`"$targetMod`"")
if ($exitCode -ne 0) {
    throw "Mod check failed with exit code $exitCode. The layout was not selected."
}
$exitCode = Invoke-Herdr @('do', 'layout.switch', '--name', 'spaces-tree')
if ($exitCode -ne 0) {
    throw "Layout switch failed with exit code $exitCode."
}
Write-Host 'Spaces Tree was updated and selected.'
