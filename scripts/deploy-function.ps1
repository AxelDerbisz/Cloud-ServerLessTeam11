# Deploy a Cloud Function
# Packages the function code and uploads it to Cloud Storage

param(
    [Parameter(Mandatory=$true)]
    [string]$FunctionName,

    [Parameter(Mandatory=$false)]
    [string]$ProjectId = "team11-dev",

    [Parameter(Mandatory=$false)]
    [string]$FunctionPath = ""
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying Function: $FunctionName" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Determine function path
if ([string]::IsNullOrEmpty($FunctionPath)) {
    # Try to find the function
    $proxyPath = "..\functions\proxy\$FunctionName"
    $workerPath = "..\functions\worker\$FunctionName"

    if (Test-Path $proxyPath) {
        $FunctionPath = $proxyPath
    } elseif (Test-Path $workerPath) {
        $FunctionPath = $workerPath
    } else {
        Write-Host "[!] Could not find function: $FunctionName" -ForegroundColor Red
        Write-Host "    Searched in: $proxyPath and $workerPath" -ForegroundColor Gray
        exit 1
    }
}

if (!(Test-Path $FunctionPath)) {
    Write-Host "[!] Function path does not exist: $FunctionPath" -ForegroundColor Red
    exit 1
}

Write-Host "[*] Function path: $FunctionPath" -ForegroundColor Cyan

# Create temp directory for packaging
$tempDir = ".\temp-deploy-$FunctionName"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy function files
Write-Host "[*] Copying function files..." -ForegroundColor Cyan
Copy-Item "$FunctionPath\*" -Destination $tempDir -Recurse

# Create ZIP file
$zipPath = ".\$FunctionName.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "[*] Creating ZIP archive..." -ForegroundColor Cyan
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

$zipSize = (Get-Item $zipPath).Length
Write-Host "[+] ZIP created: $zipPath ($zipSize bytes)" -ForegroundColor Green

# Upload to Cloud Storage
$bucketName = "$ProjectId-functions-source"
$objectPath = "$FunctionName/source.zip"

Write-Host "[*] Uploading to gs://$bucketName/$objectPath..." -ForegroundColor Cyan
gcloud storage cp $zipPath "gs://$bucketName/$objectPath" --project=$ProjectId

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Failed to upload to Cloud Storage" -ForegroundColor Red
    exit 1
}

Write-Host "[+] Upload complete!" -ForegroundColor Green
Write-Host ""

# Clean up
Remove-Item $tempDir -Recurse -Force
Remove-Item $zipPath -Force

Write-Host "========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "The function source has been uploaded to Cloud Storage." -ForegroundColor Yellow
Write-Host "The function will automatically redeploy within a few minutes." -ForegroundColor Yellow
Write-Host ""
Write-Host "To force immediate redeployment, run:" -ForegroundColor Yellow
Write-Host "  cd ..\terraform\environments\dev" -ForegroundColor Gray
Write-Host "  terraform apply -replace=`"module.$FunctionName.google_cloudfunctions2_function.function`"" -ForegroundColor Gray
Write-Host ""
Write-Host "Check logs with:" -ForegroundColor Yellow
Write-Host "  gcloud functions logs read $FunctionName --project=$ProjectId --gen2 --limit=20" -ForegroundColor Gray
