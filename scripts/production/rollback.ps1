# EasyFire Bookkeeping -- retired standalone rollback entry point
#
# This compatibility stub is intentionally non-mutating. Production rollback
# authority belongs exclusively to the canonical, journal-bound Windows action.
# Database restore is a separate destructive operation and is never inferred
# from an image rollback request.

param(
    [string]$TargetImageTag,
    [string]$BackupFile,
    [switch]$ConfirmNoSchemaChange,
    [string]$ComposeFile,
    [string]$EnvFile,
    [string]$ProjectName = "easyfire-bookkeeping-prod"
)

$ErrorActionPreference = "Stop"

Write-Host "RETIRED: scripts/production/rollback.ps1 is not an authorized production mutation path." -ForegroundColor Red
Write-Host "Use the exact completed action journal and canonical entry point:" -ForegroundColor Yellow
Write-Host "  .\deploy\windows\production-action.ps1 -Stage Rollback -ActionId <canonical-guid> -ConfirmActionId <same-canonical-guid> ..." -ForegroundColor Yellow
Write-Host "Database restore remains a separately inventoried and explicitly approved action." -ForegroundColor Yellow
Write-Host "No Docker, database, task, service, Cloudflare, or filesystem mutation was attempted." -ForegroundColor Green
exit 1
