param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Expand-Path([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Get-DocumentsPath {
    try {
        $shellFolders = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
        $personal = Expand-Path $shellFolders.Personal
        if ($personal -and (Test-Path $personal)) { return $personal }
    } catch {
        # Fall back to environment-derived locations below.
    }

    if ($env:OneDrive) {
        $candidate = Join-Path $env:OneDrive 'Documents'
        if (Test-Path $candidate) { return $candidate }
    }

    if ($env:USERPROFILE) {
        $candidate = Join-Path $env:USERPROFILE 'Documents'
        if (Test-Path $candidate) { return $candidate }
    }

    return $null
}

function Find-SaveDir {
    $documents = Get-DocumentsPath
    if ($documents) {
        $candidate = Join-Path $documents 'Paradox Interactive\Crusader Kings III\save games'
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
    }

    foreach ($root in @($env:OneDriveCommercial, $env:OneDriveConsumer, $env:OneDrive)) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'Documents\Paradox Interactive\Crusader Kings III\save games'
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
    }

    return $null
}

function Find-GameDir {
    $candidates = @()

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $candidates += (Join-Path $root 'Steam\steamapps\common\Crusader Kings III\game')
    }

    try {
        $steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if ($steamPath) {
            $candidates += (Join-Path $steamPath 'steamapps\common\Crusader Kings III\game')
        }
    } catch {
        # Steam may not be installed for this user.
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
    }

    return $null
}

$configDir = Join-Path $env:LOCALAPPDATA 'CK3-NZT'
$configPath = Join-Path $configDir 'config.json'

if ((Test-Path $configPath) -and -not $Force) {
    Write-Host "CK3-NZT configuration already exists: $configPath"
    Write-Host "Run .\configure.ps1 -Force to change it."
    exit 0
}

$saveDir = Find-SaveDir
if ($saveDir) {
    Write-Host "Found CK3 save directory: $saveDir"
} else {
    Write-Host ""
    Write-Host "CK3 save directory was not found automatically."
    Write-Host "Paste the full path to the CK3 'save games' folder."
    Write-Host "Example shape: D:\...\Paradox Interactive\Crusader Kings III\save games"
    $entered = Read-Host 'CK3 save directory'
    if (-not [string]::IsNullOrWhiteSpace($entered)) {
        $entered = $entered.Trim('"')
        if (-not (Test-Path $entered -PathType Container)) {
            throw "Directory does not exist: $entered"
        }
        $saveDir = (Resolve-Path $entered).Path
    }
}

$gameDir = Find-GameDir
if ($gameDir) {
    Write-Host "Found CK3 game directory: $gameDir"
} else {
    Write-Host ""
    Write-Host "CK3 installation directory was not found automatically."
    Write-Host "This is optional and is used for localization."
    Write-Host "Paste the full path to the CK3 'game' folder, or press Enter to skip."
    $entered = Read-Host 'CK3 game directory'
    if (-not [string]::IsNullOrWhiteSpace($entered)) {
        $entered = $entered.Trim('"')
        if (-not (Test-Path $entered -PathType Container)) {
            throw "Directory does not exist: $entered"
        }
        $gameDir = (Resolve-Path $entered).Path
    }
}

if (-not $saveDir) {
    Write-Host "No save directory configured. You can run .\configure.ps1 -Force later."
    exit 0
}

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$config = [ordered]@{
    saveDir = $saveDir
    gameDir = $gameDir
}

$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

Write-Host ""
Write-Host "Saved CK3-NZT configuration: $configPath"
Write-Host "Save directory: $saveDir"
if ($gameDir) { Write-Host "Game directory: $gameDir" }
