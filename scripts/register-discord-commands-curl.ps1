# Register Discord Slash Commands using curl
param(
    [Parameter(Mandatory=$true)]
    [string]$BotToken,

    [Parameter(Mandatory=$true)]
    [string]$ApplicationId,

    [Parameter(Mandatory=$false)]
    [string]$GuildId = ""
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Registering Discord Slash Commands (curl)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# API endpoint
if ([string]::IsNullOrEmpty($GuildId)) {
    $url = "https://discord.com/api/v10/applications/$ApplicationId/commands"
    Write-Host "[*] Registering GLOBAL commands" -ForegroundColor Yellow
} else {
    $url = "https://discord.com/api/v10/applications/$ApplicationId/guilds/$GuildId/commands"
    Write-Host "[*] Registering GUILD commands for: $GuildId" -ForegroundColor Yellow
}
Write-Host ""

# Create temp directory
$tempDir = Join-Path $env:TEMP "discord-commands"
if (!(Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

# Write JSON files without BOM using .NET
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$drawJson = '{"name":"draw","description":"Draw a pixel on the canvas","options":[{"name":"x","description":"X coordinate","type":4,"required":true},{"name":"y","description":"Y coordinate","type":4,"required":true},{"name":"color","description":"Hex color e.g. FF0000","type":3,"required":true}]}'
$canvasJson = '{"name":"canvas","description":"Get current canvas state and info"}'
$sessionJson = '{"name":"session","description":"Manage canvas session (Admin only)","options":[{"name":"action","description":"Session action","type":3,"required":true,"choices":[{"name":"start","value":"start"},{"name":"pause","value":"pause"},{"name":"reset","value":"reset"}]}]}'
$snapshotJson = '{"name":"snapshot","description":"Generate canvas snapshot image (Admin only)"}'

$commands = @(
    @{ name = "draw"; json = $drawJson },
    @{ name = "canvas"; json = $canvasJson },
    @{ name = "session"; json = $sessionJson },
    @{ name = "snapshot"; json = $snapshotJson }
)

foreach ($cmd in $commands) {
    Write-Host "[*] Registering /$($cmd.name)..." -ForegroundColor Cyan

    # Write JSON to file without BOM
    $jsonFile = Join-Path $tempDir "$($cmd.name).json"
    [System.IO.File]::WriteAllText($jsonFile, $cmd.json, $utf8NoBom)

    # Use curl with @file syntax
    $output = & curl.exe -s -X POST $url `
        -H "Authorization: Bot $BotToken" `
        -H "Content-Type: application/json" `
        -H "User-Agent: DiscordBot (https://example.com, 1.0.0)" `
        --data-binary "@$jsonFile" `
        -w "`nHTTPCODE:%{http_code}" 2>&1

    $outputStr = $output -join "`n"

    if ($outputStr -match "HTTPCODE:(\d+)") {
        $httpCode = $matches[1]
        $body = $outputStr -replace "`nHTTPCODE:\d+", ""
    } else {
        $httpCode = "000"
        $body = $outputStr
    }

    if ($httpCode -eq "200" -or $httpCode -eq "201") {
        Write-Host "[+] Successfully registered /$($cmd.name)" -ForegroundColor Green
    } else {
        Write-Host "[!] Failed /$($cmd.name) (HTTP $httpCode)" -ForegroundColor Red
        Write-Host "    $body" -ForegroundColor Gray
    }
    Write-Host ""
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "========================================" -ForegroundColor Green
Write-Host "Done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
