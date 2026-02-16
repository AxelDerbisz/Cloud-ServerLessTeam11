# Setup Google Secret Manager secrets for the application
# Run this script before deploying infrastructure

param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectId = "team11-dev",

    [Parameter(Mandatory=$false)]
    [string]$DiscordPublicKey = "",

    [Parameter(Mandatory=$false)]
    [string]$DiscordClientSecret = "",

    [Parameter(Mandatory=$false)]
    [string]$DiscordBotToken = "",

    [Parameter(Mandatory=$false)]
    [string]$JwtSecret = ""
)

$ErrorActionPreference = "Stop"

# Suppress gcloud command progress output
$env:CLOUDSDK_CORE_DISABLE_PROMPTS = "1"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setting up Secret Manager secrets" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Generate random JWT secret if not provided
if ([string]::IsNullOrEmpty($JwtSecret)) {
    $JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object {[char]$_})
    Write-Host "[*] Generated random JWT secret" -ForegroundColor Yellow
}

function Create-Secret {
    param(
        [string]$SecretId,
        [string]$SecretValue,
        [string]$Description,
        [string[]]$ExistingSecrets
    )

    Write-Host "[*] Creating secret: $SecretId" -ForegroundColor Cyan

    if ([string]::IsNullOrEmpty($SecretValue)) {
        Write-Host "[!] Warning: $SecretId is empty. You'll need to update it later." -ForegroundColor Yellow
        $SecretValue = "PLACEHOLDER_VALUE_CHANGE_ME"
    }

    # Check if secret exists in the pre-fetched list
    $secretExists = $ExistingSecrets -contains $SecretId

    if ($secretExists) {
        Write-Host "    Secret already exists, adding new version..." -ForegroundColor Gray
        echo $SecretValue | gcloud secrets versions add $SecretId --data-file=- --project=$ProjectId
    } else {
        Write-Host "    Creating new secret..." -ForegroundColor Gray
        echo $SecretValue | gcloud secrets create $SecretId `
            --replication-policy="automatic" `
            --data-file=- `
            --project=$ProjectId
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Secret $SecretId created/updated successfully" -ForegroundColor Green
    } else {
        Write-Host "[!] Failed to create/update secret $SecretId" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Enable Secret Manager API
Write-Host "[*] Enabling Secret Manager API..." -ForegroundColor Cyan
gcloud services enable secretmanager.googleapis.com --project=$ProjectId 2>&1 | Out-Null
Write-Host ""

# Get list of existing secrets
Write-Host "[*] Checking existing secrets..." -ForegroundColor Cyan
$existingSecretsOutput = gcloud secrets list --project=$ProjectId --format="value(name)" 2>&1
$existingSecrets = @()
if ($LASTEXITCODE -eq 0) {
    $existingSecrets = $existingSecretsOutput -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}
Write-Host ""

# Create secrets
Create-Secret -SecretId "discord-public-key" -SecretValue $DiscordPublicKey -Description "Discord application public key for signature verification" -ExistingSecrets $existingSecrets
Create-Secret -SecretId "discord-client-secret" -SecretValue $DiscordClientSecret -Description "Discord OAuth2 client secret" -ExistingSecrets $existingSecrets
Create-Secret -SecretId "discord-bot-token" -SecretValue $DiscordBotToken -Description "Discord bot token" -ExistingSecrets $existingSecrets
Create-Secret -SecretId "jwt-secret" -SecretValue $JwtSecret -Description "JWT signing secret for web authentication" -ExistingSecrets $existingSecrets

Write-Host "========================================" -ForegroundColor Green
Write-Host "Secrets setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: If any secrets were empty, update them with:" -ForegroundColor Yellow
Write-Host "  echo YOUR_SECRET_VALUE | gcloud secrets versions add SECRET_NAME --data-file=- --project=$ProjectId" -ForegroundColor Gray
Write-Host ""
Write-Host "List secrets with:" -ForegroundColor Yellow
Write-Host "  gcloud secrets list --project=$ProjectId" -ForegroundColor Gray
