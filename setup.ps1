param(
    [string]$InstallDir = "",
    [Alias("SkipTests")]
    [switch]$SkipVerification,
    [switch]$ExportAfterBuild,
    [switch]$Reconfigure,
    [switch]$InstallGoogleDrive
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/vejinnovem/ck3-nzt.git"
$MinimumNodeMajor = 22
$MinimumNodeMinorFor22 = 13
$InstalledGitThisRun = $false
$InstalledNodeThisRun = $false
$InstalledGoogleDriveThisRun = $false

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Require-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "WinGet is required for automatic prerequisite installation. Install/update Microsoft App Installer, then run this script again."
    }
}

function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) { return }

    Require-Winget
    Write-Host "Installing Git..."
    winget install --id Git.Git -e --source winget `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Git installation failed with exit code $LASTEXITCODE." }

    $script:InstalledGitThisRun = $true
    Refresh-Path
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git was installed but is not available in PATH. Open a new PowerShell window and run setup.ps1 again."
    }
}

function Test-NodeVersion {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }

    $raw = (node --version).TrimStart("v")
    $parts = $raw.Split(".")
    $major = [int]$parts[0]
    $minor = [int]$parts[1]

    if ($major -gt $MinimumNodeMajor) { return $true }
    if ($major -lt $MinimumNodeMajor) { return $false }
    return $minor -ge $MinimumNodeMinorFor22
}

function Ensure-Node {
    if (Test-NodeVersion) { return }

    Require-Winget
    Write-Host "Installing a current Node.js LTS release..."
    winget install --id OpenJS.NodeJS.LTS -e --source winget `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Node.js installation failed with exit code $LASTEXITCODE." }

    $script:InstalledNodeThisRun = $true
    Refresh-Path
    if (-not (Test-NodeVersion)) {
        throw "CK3-NZT requires Node.js 22.13 or newer. Open a new PowerShell window and run setup.ps1 again."
    }
}

function Test-GoogleDriveInstalled {
    if (-not $env:ProgramFiles) { return $false }
    return Test-Path (Join-Path $env:ProgramFiles 'Google\Drive File Stream')
}

function Start-GoogleDrive {
    if (-not $env:ProgramFiles) { return }
    $root = Join-Path $env:ProgramFiles 'Google\Drive File Stream'
    if (-not (Test-Path $root)) { return }

    $exe = Get-ChildItem -Path $root -Filter 'GoogleDriveFS.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($exe) {
        Start-Process -FilePath $exe.FullName -ErrorAction SilentlyContinue | Out-Null
    }
}

function Ensure-GoogleDrive {
    if (Test-GoogleDriveInstalled) {
        Write-Host "Google Drive for desktop is already installed."
        Start-GoogleDrive
        return
    }

    Require-Winget
    Write-Host "Installing Google Drive for desktop..."
    winget install --id Google.GoogleDrive -e --source winget `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Google Drive installation failed with exit code $LASTEXITCODE." }

    $script:InstalledGoogleDriveThisRun = $true
    Start-GoogleDrive
}

function Get-HashOrNull([string]$Path) {
    if (Test-Path $Path) {
        return (Get-FileHash $Path -Algorithm SHA256).Hash
    }
    return $null
}

Ensure-Git
Ensure-Node

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot ".git"))) {
        $InstallDir = $PSScriptRoot
    } else {
        $InstallDir = Join-Path $env:LOCALAPPDATA "CK3-NZT\app"
    }
}

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$repoGitDir = Join-Path $InstallDir ".git"
$lockPath = Join-Path $InstallDir "package-lock.json"
$configPath = Join-Path $env:LOCALAPPDATA "CK3-NZT\config.json"
$needDependencies = $false
$freshInstall = -not (Test-Path $repoGitDir)

if ($freshInstall) {
    if (Test-Path $InstallDir) {
        $items = Get-ChildItem -Force $InstallDir -ErrorAction SilentlyContinue
        if ($items.Count -gt 0) {
            throw "Install directory exists and is not an empty Git repository: $InstallDir"
        }
    }

    $parent = Split-Path -Parent $InstallDir
    New-Item -ItemType Directory -Force -Path $parent | Out-Null

    Write-Host "Cloning CK3-NZT into $InstallDir..."
    git clone $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed." }
    $needDependencies = $true
} else {
    Push-Location $InstallDir
    try {
        $changes = git status --porcelain
        if ($changes) {
            throw "Local changes detected in $InstallDir. Update aborted so nothing is overwritten. Commit, stash, or discard them first."
        }

        $oldLockHash = Get-HashOrNull $lockPath
        Write-Host "Updating CK3-NZT from main..."
        git fetch origin main
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }
        git checkout main
        if ($LASTEXITCODE -ne 0) { throw "git checkout main failed." }
        git pull --ff-only origin main
        if ($LASTEXITCODE -ne 0) { throw "git pull failed." }

        $newLockHash = Get-HashOrNull $lockPath
        if ($oldLockHash -ne $newLockHash) { $needDependencies = $true }
    } finally {
        Pop-Location
    }
}

Push-Location $InstallDir
try {
    if ($needDependencies -or -not (Test-Path (Join-Path $InstallDir "node_modules"))) {
        Write-Host "Installing npm dependencies..."
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    }

    if (-not $SkipVerification) {
        Write-Host "Running local verification..."
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir "verify.ps1")
        if ($LASTEXITCODE -ne 0) {
            throw "Local verification failed. Review the summary above."
        }
    } else {
        Write-Host "Verification skipped; building CK3-NZT..."
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Build failed." }
    }

    $shouldInstallGoogleDrive = $InstallGoogleDrive
    if ($freshInstall -and -not (Test-GoogleDriveInstalled) -and -not $InstallGoogleDrive) {
        Write-Host ""
        Write-Host "Optional: Google Drive for desktop can sync CK3-NZT's compact AI export for ChatGPT."
        $answer = Read-Host 'Install Google Drive for desktop now? [y/N]'
        if ($answer -match '^(y|yes)$') { $shouldInstallGoogleDrive = $true }
    }

    if ($shouldInstallGoogleDrive) {
        Write-Host ""
        Ensure-GoogleDrive
        if ($InstalledGoogleDriveThisRun) {
            Write-Host ""
            Write-Host "Google Drive for desktop was installed and started."
            Write-Host "Complete sign-in in Google Drive/browser. When My Drive is visible in File Explorer, press Enter."
            Write-Host "You may also press Enter immediately and configure the synced export folder later with .\setup.ps1 -Reconfigure."
            Read-Host | Out-Null
        }
    }

    if ($Reconfigure -or -not (Test-Path $configPath)) {
        Write-Host ""
        Write-Host "Configuring CK3 paths and AI export..."
        $configureArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $InstallDir 'configure.ps1'))
        if ($Reconfigure) { $configureArgs += '-Force' }
        & powershell.exe @configureArgs
        if ($LASTEXITCODE -ne 0) { throw "CK3 configuration failed." }
    }

    if ($ExportAfterBuild) {
        Write-Host "Reading the newest CK3 save..."
        npm run export
        if ($LASTEXITCODE -ne 0) { throw "CK3 state export failed." }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "CK3-NZT is ready."
Write-Host "Application: $InstallDir"
Write-Host "Configuration: $configPath"
Write-Host "Node: $(node --version)"
Write-Host "Git:  $(git --version)"
Write-Host "Run 'npm run export' inside the application directory to capture the newest CK3 state."
Write-Host "Run '.\setup.ps1 -Reconfigure' to change CK3/export paths later."
if (-not (Test-GoogleDriveInstalled)) {
    Write-Host "Run '.\setup.ps1 -InstallGoogleDrive' if you want to add the optional Google Drive bridge later."
} elseif ($InstalledGoogleDriveThisRun -and -not $Reconfigure -and (Test-Path $configPath)) {
    Write-Host "After Google Drive sign-in, run '.\setup.ps1 -Reconfigure' to point AI export at a folder inside My Drive."
}

if ($InstalledGitThisRun -or $InstalledNodeThisRun) {
    Write-Host ""
    Write-Host "A prerequisite was installed during this run."
    Write-Host "If setup.ps1 was launched through a separate powershell.exe process, the PowerShell window that launched it may still have the old PATH."
    Write-Host "Open a new PowerShell window before using git/npm, or refresh PATH in the current window with:"
    Write-Host '$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")'
}
