# Register Discord Slash Commands
# Run this script after setting up your Discord application

param(
    [Parameter(Mandatory=$true)]
    [string]$BotToken,

    [Parameter(Mandatory=$true)]
    [string]$ApplicationId,

    [Parameter(Mandatory=$false)]
    [string]$GuildId = ""  # Leave empty for global commands (takes ~1 hour to propagate)
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Registering Discord Slash Commands" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Define slash commands
$commands = @(
    @{
        name = "draw"
        description = "Draw a pixel on the canvas"
        options = @(
            @{
                name = "x"
                description = "X coordinate"
                type = 4  # INTEGER
                required = $true
            },
            @{
                name = "y"
                description = "Y coordinate"
                type = 4  # INTEGER
                required = $true
            },
            @{
                name = "color"
                description = "Hex color (e.g., #FF0000 or red)"
                type = 3  # STRING
                required = $true
            }
        )
    },
    @{
        name = "canvas"
        description = "Get current canvas state and info"
    },
    @{
        name = "session"
        description = "Manage canvas session (Admin only)"
        options = @(
            @{
                name = "action"
                description = "Session action"
                type = 3  # STRING
                required = $true
                choices = @(
                    @{ name = "start"; value = "start" },
                    @{ name = "pause"; value = "pause" },
                    @{ name = "reset"; value = "reset" }
                )
            }
        )
    },
    @{
        name = "snapshot"
        description = "Generate canvas snapshot image (Admin only)"
    }
)

# API endpoint
if ([string]::IsNullOrEmpty($GuildId)) {
    $url = "https://discord.com/api/v10/applications/$ApplicationId/commands"
    Write-Host "[*] Registering GLOBAL commands (may take up to 1 hour to propagate)" -ForegroundColor Yellow
} else {
    $url = "https://discord.com/api/v10/applications/$ApplicationId/guilds/$GuildId/commands"
    Write-Host "[*] Registering GUILD commands for guild: $GuildId (instant)" -ForegroundColor Green
}

Write-Host ""

# Register each command
foreach ($command in $commands) {
    Write-Host "[*] Registering /$($command.name)..." -ForegroundColor Cyan

    $json = $command | ConvertTo-Json -Depth 10

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers @{
            "Authorization" = "Bot $BotToken"
            "Content-Type" = "application/json"
        } -Body $json

        Write-Host "[+] Successfully registered /$($command.name) (ID: $($response.id))" -ForegroundColor Green
    } catch {
        Write-Host "[!] Failed to register /$($command.name): $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            Write-Host "    Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
        }
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "Command registration complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Go to Discord Developer Portal > Your App > General Information" -ForegroundColor Gray
Write-Host "2. Set 'Interactions Endpoint URL' to:" -ForegroundColor Gray
Write-Host "   https://pixel-canvas-gateway-86fcxr1p.ew.gateway.dev/discord/webhook" -ForegroundColor White
Write-Host "3. Discord will send a PING to verify the endpoint" -ForegroundColor Gray
Write-Host "4. If verification fails, check Cloud Function logs" -ForegroundColor Gray
Write-Host ""
