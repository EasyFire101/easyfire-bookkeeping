# EasyFire Bookkeeping -- retired automated owner bootstrap
#
# The historical helper could leave a partially created user/tenant topology
# when asynchronous organization construction failed. That state was neither
# safely resumable nor automatically reversible. This compatibility entry
# point is intentionally non-mutating until a separately reviewed state-machine
# implementation exists.

param(
    [ValidateSet("Preflight", "Action", "Postcheck", "Rollback")]
    [string]$Stage = "Preflight",
    [string]$ComposeFile,
    [string]$EnvFile,
    [string]$CloudflareCredentialFile,
    [string]$BackupDir,
    [string]$BackupScript,
    [string]$ActionId,
    [string]$ConfirmActionId,
    [string]$OwnerFirstName,
    [string]$OwnerLastName,
    [string]$OrganizationName
)

$ErrorActionPreference = "Stop"

Write-Host "RETIRED: automated production owner bootstrap is not authorized in this release." -ForegroundColor Red
Write-Host "Reason: asynchronous organization construction is not yet a transactionally resumable state machine." -ForegroundColor Yellow
Write-Host "Use authenticated application onboarding only after a separate real-data scope is approved." -ForegroundColor Yellow
Write-Host "No API, Docker, database, task, service, credential, or filesystem mutation was attempted." -ForegroundColor Green
exit 1
