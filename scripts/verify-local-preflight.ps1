<#
.SYNOPSIS
Read-only Windows preflight before local verification. Never prints database credentials.
#>
[CmdletBinding()]
param(
    [Nullable[double]]$MinimumFreeDiskGiB,
    [switch]$RequireDatabase
)

$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $workspacePath 'package.json') -Raw | ConvertFrom-Json
$persistentDevCache = $env:INTELLIFIN_LOW_DISK -ne '1'
if ($null -eq $MinimumFreeDiskGiB) { $MinimumFreeDiskGiB = if ($persistentDevCache) { 3 } else { 1 } }

function Read-CheckedVersion([string]$Program, [string[]]$Arguments) {
    $result = & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Could not read the version of $Program." }
    return (($result | Out-String).Trim())
}

$nodeVersion = Read-CheckedVersion 'node' @('--version')
$pnpmVersion = Read-CheckedVersion 'pnpm' @('--version')
$pnpmNodeVersion = Read-CheckedVersion 'pnpm' @('exec', 'node', '--version')
if ($nodeVersion -ne "v$($manifest.engines.node)" -or $pnpmNodeVersion -ne $nodeVersion) {
    throw 'Node or the pnpm sibling runtime differs from the repository pin. Fix PATH/corepack before verification.'
}
if ($pnpmVersion -ne $manifest.engines.pnpm) { throw 'pnpm differs from the repository pin.' }

$driveRoot = [System.IO.Path]::GetPathRoot($workspacePath)
$drive = [System.IO.DriveInfo]::new($driveRoot)
$freeDiskGiB = [math]::Round($drive.AvailableFreeSpace / 1GB, 2)
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$freeMemoryGiB = [math]::Round(($operatingSystem.FreePhysicalMemory * 1KB) / 1GB, 2)
if ($freeDiskGiB -lt $MinimumFreeDiskGiB) {
    throw "Only $freeDiskGiB GiB is free on the workspace drive; restore space before generators or builds."
}

$databaseStatus = 'Not requested'
if ($RequireDatabase) {
    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { throw 'DATABASE_URL is required for database verification.' }
    try { $databaseUri = [uri]$env:DATABASE_URL } catch { throw 'DATABASE_URL is not a valid URI.' }
    if ($databaseUri.Scheme -notin @('postgres', 'postgresql')) { throw 'DATABASE_URL must use PostgreSQL.' }
    $databasePort = if ($databaseUri.Port -gt 0) { $databaseUri.Port } else { 5432 }
    & pg_isready -h $databaseUri.Host -p $databasePort -t 5 *> $null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is not accepting connections. Check the isolated test service.' }
    $databaseStatus = 'Accepting connections (authentication/schema still checked by the suite)'
}

[pscustomobject]@{
    Node = $nodeVersion
    Pnpm = $pnpmVersion
    PnpmNode = $pnpmNodeVersion
    FreeDiskGiB = $freeDiskGiB
    FreeMemoryGiB = $freeMemoryGiB
    MemoryAssessment = 'Informational; workload memory needs vary, keep heavy suites serial'
    PersistentDevCache = $persistentDevCache
    Database = $databaseStatus
    VerificationPolicy = 'One heavy suite at a time; browser before production web build'
}
