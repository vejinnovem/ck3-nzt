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

function Normalize-GameDir([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }

    $Path = $Path.Trim('"')
    if (-not (Test-Path $Path -PathType Container)) { return $null }

    $resolved = (Resolve-Path $Path).Path
    if (Test-Path (Join-Path $resolved 'localization') -PathType Container) {
        return $resolved
    }

    $nestedGame = Join-Path $resolved 'game'
    if (Test-Path (Join-Path $nestedGame 'localization') -PathType Container) {
        return (Resolve-Path $nestedGame).Path
    }

    return $null
}

function Get-SteamLibraryRoots {
    $roots = @()
    $steamPath = $null

    try {
        $steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
    } catch {
        # Steam may not be installed for this user.
    }

    if ($steamPath -and (Test-Path $steamPath)) {
        $roots += $steamPath
        $vdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($line in Get-Content $vdf -ErrorAction SilentlyContinue) {
                if ($line -match '"path"\s+"([^"]+)"') {
                    $library = $Matches[1] -replace '\\\\', '\'
                    if ($library -and (Test-Path $library)) {
                        $roots += $library
                    }
                }
            }
        }
    }

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $candidate = Join-Path $root 'Steam'
        if (Test-Path $candidate) { $roots += $candidate }
    }

    return $roots | Select-Object -Unique
}

function Find-GameDir {
    foreach ($root in Get-SteamLibraryRoots) {
        $candidate = Join-Path $root 'steamapps\common\Crusader Kings III\game'
        $normalized = Normalize-GameDir $candidate
        if ($normalized) { return $normalized }
    }

    return $null
}

function Resolve-OutputDir([string]$Entered, [string]$Fallback) {
    if ([string]::IsNullOrWhiteSpace($Entered)) { return $Fallback }

    $expanded = Expand-Path ($Entered.Trim('"'))
    try {
        New-Item -ItemType Directory -Force -Path $expanded | Out-Null
        return (Resolve-Path $expanded).Path
    } catch {
        throw "Could not create or access AI export directory: $expanded"
    }
}

function Get-GoogleDriveRoots {
    $roots = @()

    # Drive for desktop supports a configurable mount point. Prefer Google's
    # documented DriveFS settings before falling back to volume discovery.
    foreach ($registryPath in @(
        'HKCU:\Software\Google\DriveFS',
        'HKLM:\Software\Google\DriveFS',
        'HKLM:\Software\Policies\Google\DriveFS'
    )) {
        try {
            $settings = Get-ItemProperty $registryPath -ErrorAction Stop
            $mountPoint = Expand-Path ([string]$settings.DefaultMountPoint)
            if ($mountPoint) {
                $mountPoint = $mountPoint.Trim('"')
                if ($mountPoint -match '^[A-Za-z]:$') { $mountPoint += '\' }
                if (Test-Path $mountPoint) {
                    $roots += (Resolve-Path $mountPoint).Path
                }
            }
        } catch {
            # This scope may not define DefaultMountPoint; continue with fallbacks.
        }
    }

    try {
        foreach ($disk in Get-CimInstance Win32_LogicalDisk -ErrorAction Stop) {
            if (-not $disk.DeviceID) { continue }
            $label = [string]$disk.VolumeName
            if ($label -match 'Google Drive') {
                $candidate = "$($disk.DeviceID)\"
                if (Test-Path $candidate) { $roots += $candidate }
            }
        }
    } catch {
        # CIM may be unavailable in restricted environments; PSDrive is a fallback.
    }

    try {
        foreach ($drive in Get-PSDrive -PSProvider FileSystem -ErrorAction Stop) {
            if ([string]$drive.Description -match 'Google Drive') {
                if (Test-Path $drive.Root) { $roots += $drive.Root }
            }
        }
    } catch {
        # Ignore and fall back to manual path entry.
    }

    return @($roots | Select-Object -Unique)
}

function Select-NumberedPath([string]$Title, [array]$Items) {
    if ($Items.Count -eq 0) { return $null }
    if ($Items.Count -eq 1) { return [string]$Items[0] }

    Write-Host ""
    Write-Host $Title
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("[{0}] {1}" -f ($i + 1), $Items[$i])
    }

    while ($true) {
        $choice = Read-Host 'Select number'
        $number = 0
        if ([int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $Items.Count) {
            return [string]$Items[$number - 1]
        }
        Write-Host "Enter a number from 1 to $($Items.Count)."
    }
}

function Find-GoogleDriveExportDir {
    $roots = @(Get-GoogleDriveRoots)
    if ($roots.Count -eq 0) { return $null }

    $root = Select-NumberedPath 'Multiple Google Drive mount points were found:' $roots
    if (-not $root) { return $null }

    $topLevelDirs = @(
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } |
            ForEach-Object { $_.FullName }
    )

    if ($topLevelDirs.Count -eq 0) {
        return $null
    }

    $personalRoot = Select-NumberedPath 'Select the Google Drive area where CK3-NZK should be created:' $topLevelDirs
    if (-not $personalRoot) { return $null }

    $target = Join-Path $personalRoot 'CK3-NZK'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    return (Resolve-Path $target).Path
}

$configDir = Join-Path $env:LOCALAPPDATA 'CK3-NZT'
$configPath = Join-Path $configDir 'config.json'
$defaultOutputDir = Join-Path $configDir 'export'
$existingConfig = $null

if (Test-Path $configPath) {
    try {
        $existingConfig = Get-Content $configPath -Raw | ConvertFrom-Json
    } catch {
        $existingConfig = $null
    }
}

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
    Write-Host "Paste either the CK3 install folder or its 'game' subfolder, or press Enter to skip."
    $entered = Read-Host 'CK3 installation/game directory'
    if (-not [string]::IsNullOrWhiteSpace($entered)) {
        $gameDir = Normalize-GameDir $entered
        if (-not $gameDir) {
            throw "Could not find CK3 localization under that directory. Expected either '<path>\localization' or '<path>\game\localization'."
        }
    }
}

if (-not $saveDir) {
    Write-Host "No save directory configured. You can run .\configure.ps1 -Force later."
    exit 0
}

$currentOutputDir = $defaultOutputDir
if ($existingConfig -and $existingConfig.outputDir) {
    $currentOutputDir = [string]$existingConfig.outputDir
}

Write-Host ""
Write-Host "AI export directory"
Write-Host "CK3-NZT can keep compact AI files locally or write them directly into Google Drive."
$googleOutputDir = Find-GoogleDriveExportDir
if ($googleOutputDir) {
    Write-Host "Detected Google Drive export directory: $googleOutputDir"
    $useGoogle = Read-Host 'Use this directory for AI exports? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($useGoogle) -or $useGoogle -match '^[YyTt]') {
        $outputDir = $googleOutputDir
    }
}

if (-not $outputDir) {
    Write-Host "Current/default: $currentOutputDir"
    $enteredOutput = Read-Host 'AI export directory (press Enter to keep current/default)'
    $outputDir = Resolve-OutputDir $enteredOutput $currentOutputDir
}

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$config = [ordered]@{
    saveDir = $saveDir
    gameDir = $gameDir
    outputDir = $outputDir
}

$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

Write-Host ""
Write-Host "Saved CK3-NZT configuration: $configPath"
Write-Host "Save directory: $saveDir"
if ($gameDir) { Write-Host "Game directory: $gameDir" }
Write-Host "AI export directory: $outputDir"
