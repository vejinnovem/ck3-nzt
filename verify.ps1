param()

$ErrorActionPreference = "Continue"

$checks = @(
    @{ Name = "Format"; Args = @("run", "format:check") },
    @{ Name = "Lint"; Args = @("run", "lint") },
    @{ Name = "Build"; Args = @("run", "build") },
    @{ Name = "Tests"; Args = @("test") }
)

$results = @()

foreach ($check in $checks) {
    Write-Host ""
    Write-Host "=== $($check.Name) ==="

    & npm.cmd @($check.Args)
    $exitCode = $LASTEXITCODE

    $results += [PSCustomObject]@{
        Check = $check.Name
        ExitCode = $exitCode
        Passed = ($exitCode -eq 0)
    }
}

Write-Host ""
Write-Host "=== CK3-NZT verification summary ==="

foreach ($result in $results) {
    $status = if ($result.Passed) { "PASS" } else { "FAIL" }
    Write-Host ("{0,-10} {1} (exit {2})" -f $result.Check, $status, $result.ExitCode)
}

$failed = @($results | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "$($failed.Count) verification step(s) failed."
    exit 1
}

Write-Host ""
Write-Host "All verification steps passed."
exit 0
