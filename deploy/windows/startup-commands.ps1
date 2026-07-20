# EasyFire Bookkeeping -- retired compatibility entry point.
# Scheduled-task authority belongs only to production-action.ps1.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host 'RETIRED: standalone scheduled-task templates are not authorized.' -ForegroundColor Red
Write-Host 'The journal-bound controller owns the exact daily backup task.' -ForegroundColor Yellow
exit 64
