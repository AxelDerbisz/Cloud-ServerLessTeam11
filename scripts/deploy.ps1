# Deployment script for the serverless pixel canvas infrastructure
# This script automates the deployment process

param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectId = "team11-dev",

    [Parameter(Mandatory=$false)]
    [string]$Region = "europe-west1",

    [Parameter(Mandatory=$false)]
    [switch]$SkipSecrets = $false,

    [Parameter(Mandatory=$false)]
    [switch]$AutoApprove = $false
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying Pixel Canvas Infrastructure" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project ID: $ProjectId" -ForegroundColor Gray
Write-Host "Region: $Region" -ForegroundColor Gray
Write-Host ""

# Set the GCP project
Write-Host "[1/6] Setting GCP project..." -ForegroundColor Cyan
gcloud config set project $ProjectId
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Failed to set project. Make sure you're authenticated with gcloud." -ForegroundColor Red
    exit 1
}
Write-Host "[+] Project set successfully" -ForegroundColor Green
Write-Host ""

# Create placeholder function ZIP
Write-Host "[2/6] Creating placeholder function..." -ForegroundColor Cyan
& "$PSScriptRoot\create-placeholder.ps1" -OutputPath "$PSScriptRoot\placeholder.zip"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Failed to create placeholder function" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Setup secrets
if (-not $SkipSecrets) {
    Write-Host "[3/6] Setting up secrets..." -ForegroundColor Cyan
    Write-Host "[!] You'll be prompted for Discord credentials" -ForegroundColor Yellow
    Write-Host ""

    & "$PSScriptRoot\setup-secrets.ps1" -ProjectId $ProjectId
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[!] Failed to setup secrets" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[3/6] Skipping secrets setup (--SkipSecrets flag provided)" -ForegroundColor Yellow
}
Write-Host ""

# Initialize Terraform
Write-Host "[4/6] Initializing Terraform..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\..\terraform\environments\dev"
terraform init
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "[!] Terraform init failed" -ForegroundColor Red
    exit 1
}
Write-Host "[+] Terraform initialized" -ForegroundColor Green
Write-Host ""

# Plan Terraform deployment
Write-Host "[5/6] Planning Terraform deployment..." -ForegroundColor Cyan
terraform plan -out=tfplan
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "[!] Terraform plan failed" -ForegroundColor Red
    exit 1
}
Write-Host "[+] Terraform plan created" -ForegroundColor Green
Write-Host ""

# Apply Terraform deployment
Write-Host "[6/6] Applying Terraform deployment..." -ForegroundColor Cyan
if ($AutoApprove) {
    terraform apply tfplan
} else {
    Write-Host ""
    Write-Host "Review the plan above. Do you want to proceed with deployment?" -ForegroundColor Yellow
    $confirmation = Read-Host "Type 'yes' to continue"
    if ($confirmation -eq 'yes') {
        terraform apply tfplan
    } else {
        Pop-Location
        Write-Host "[!] Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
}

if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "[!] Terraform apply failed" -ForegroundColor Red
    exit 1
}

# Show outputs
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Important URLs and Information:" -ForegroundColor Cyan
terraform output
Write-Host ""

Pop-Location

Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Configure Discord webhook URL in Discord Developer Portal" -ForegroundColor Gray
Write-Host "  2. Deploy actual function implementations" -ForegroundColor Gray
Write-Host "  3. Register Discord slash commands" -ForegroundColor Gray
Write-Host "  4. Deploy web application to Cloud Storage" -ForegroundColor Gray
Write-Host ""
