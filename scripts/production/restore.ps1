# EasyFire Bookkeeping -- Retired Standalone Restore Entry Point
#
# This path is intentionally non-mutating. Production restore and existing-data
# recovery require a separately approved, journal-bound blue/green procedure.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [string]$ComposeFile = "$PSScriptRoot\..\..\docker-compose.prod.yml",
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [string]$ProjectName = 'easyfire-bookkeeping-prod',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Write-Error @'
The retired standalone restore entry point is not an authorized production mutation path.
Use restore-verify.ps1 only for isolated verification. Restoring existing production data
requires a separately approved, journal-bound blue/green recovery procedure.
'@
exit 1
