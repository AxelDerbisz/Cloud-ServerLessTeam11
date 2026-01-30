# Test Discord Bot Token and Permissions
param(
    [Parameter(Mandatory=$true)]
    [string]$BotToken,

    [Parameter(Mandatory=$false)]
    [string]$GuildId = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Discord Bot Configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Verify bot token by getting bot user info
Write-Host "[1] Testing bot token..." -ForegroundColor Yellow
try {
    $botInfo = Invoke-RestMethod -Uri "https://discord.com/api/v10/users/@me" -Headers @{
        "Authorization" = "Bot $BotToken"
    }
    Write-Host "[+] Bot token is VALID" -ForegroundColor Green
    Write-Host "    Bot Username: $($botInfo.username)#$($botInfo.discriminator)" -ForegroundColor Gray
    Write-Host "    Bot ID: $($botInfo.id)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "[!] Bot token is INVALID" -ForegroundColor Red
    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please regenerate your bot token in Discord Developer Portal" -ForegroundColor Yellow
    exit 1
}

# Test 2: Get application info
Write-Host "[2] Getting application info..." -ForegroundColor Yellow
try {
    $appInfo = Invoke-RestMethod -Uri "https://discord.com/api/v10/applications/@me" -Headers @{
        "Authorization" = "Bot $BotToken"
    }
    Write-Host "[+] Application found" -ForegroundColor Green
    Write-Host "    App Name: $($appInfo.name)" -ForegroundColor Gray
    Write-Host "    App ID: $($appInfo.id)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "[!] Could not get application info: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
}

# Test 3: Check guild access
if (![string]::IsNullOrEmpty($GuildId)) {
    Write-Host "[3] Checking guild access for: $GuildId" -ForegroundColor Yellow
    try {
        $guildInfo = Invoke-RestMethod -Uri "https://discord.com/api/v10/guilds/$GuildId" -Headers @{
            "Authorization" = "Bot $BotToken"
        }
        Write-Host "[+] Bot has access to guild" -ForegroundColor Green
        Write-Host "    Guild Name: $($guildInfo.name)" -ForegroundColor Gray
        Write-Host ""
    } catch {
        Write-Host "[!] Bot does NOT have access to this guild" -ForegroundColor Red
        Write-Host "    Error: $($_.ErrorDetails.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Make sure:" -ForegroundColor Yellow
        Write-Host "  1. The Guild ID is correct (right-click server > Copy Server ID)" -ForegroundColor Gray
        Write-Host "  2. The bot has been invited to the server" -ForegroundColor Gray
        Write-Host "  3. Use this invite URL:" -ForegroundColor Gray
        Write-Host "     https://discord.com/api/oauth2/authorize?client_id=$($botInfo.id)&scope=bot%20applications.commands&permissions=0" -ForegroundColor White
        Write-Host ""
    }

    # Test 4: Try to list existing commands
    Write-Host "[4] Checking existing guild commands..." -ForegroundColor Yellow
    try {
        $commands = Invoke-RestMethod -Uri "https://discord.com/api/v10/applications/$($appInfo.id)/guilds/$GuildId/commands" -Headers @{
            "Authorization" = "Bot $BotToken"
        }
        Write-Host "[+] Can access guild commands" -ForegroundColor Green
        Write-Host "    Existing commands: $($commands.Count)" -ForegroundColor Gray
        foreach ($cmd in $commands) {
            Write-Host "      - /$($cmd.name)" -ForegroundColor Gray
        }
        Write-Host ""
    } catch {
        Write-Host "[!] Cannot access guild commands" -ForegroundColor Red
        Write-Host "    Error: $($_.ErrorDetails.Message)" -ForegroundColor Red
        Write-Host ""
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
