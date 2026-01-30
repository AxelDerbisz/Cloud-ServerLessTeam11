# Deploy All Cloud Functions
# Packages and uploads all function code to Cloud Storage

param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectId = "team11-dev"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying All Functions" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$functions = @(
    "discord-proxy",
    "web-proxy",
    "auth-handler",
    "pixel-worker",
    "discord-worker",
    "snapshot-worker",
    "session-worker"
)

$successCount = 0
$failCount = 0

foreach ($funcName in $functions) {
    Write-Host "------------------------------------" -ForegroundColor Yellow
    Write-Host "[$($successCount + $failCount + 1)/$($functions.Count)] Deploying: $funcName" -ForegroundColor Yellow
    Write-Host "------------------------------------" -ForegroundColor Yellow

    try {
        .\deploy-function.ps1 -FunctionName $funcName -ProjectId $ProjectId
        $successCount++
    } catch {
        Write-Host "[!] Failed to deploy $funcName" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        $failCount++
    }

    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "Deployment Summary" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Success: $successCount" -ForegroundColor Green
Write-Host "Failed:  $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($successCount -eq $functions.Count) {
    Write-Host "[+] All functions deployed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The functions will automatically redeploy within a few minutes." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To force immediate redeployment for all functions, run:" -ForegroundColor Yellow
    Write-Host "  cd ..\terraform\environments\dev" -ForegroundColor Gray
    Write-Host "  terraform apply -auto-approve" -ForegroundColor Gray
} else {
    Write-Host "[!] Some functions failed to deploy. Check the errors above." -ForegroundColor Red
    exit 1
}
