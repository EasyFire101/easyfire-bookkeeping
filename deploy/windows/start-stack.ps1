# EasyFire Bookkeeping -- retired compatibility entry point.
# Runtime services restart through their sealed Compose restart policies.
# Raw Compose startup would bypass the journal-approved inventory authority.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host 'RETIRED: standalone stack startup is not authorized.' -ForegroundColor Red
Write-Host 'Use Docker restart policies and the journal-bound production controller.' -ForegroundColor Yellow
exit 64
