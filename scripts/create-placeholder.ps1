# Create placeholder function ZIP file for initial deployment
# This creates a minimal valid Node.js function that can be deployed

param(
    [Parameter(Mandatory=$false)]
    [string]$OutputPath = ".\placeholder.zip"
)

$ErrorActionPreference = "Stop"

Write-Host "[*] Creating placeholder function" -ForegroundColor Cyan

# Create temp directory
$tempDir = ".\temp-placeholder-func"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Create package.json
$packageJson = @"
{
  "name": "placeholder-function",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@google-cloud/functions-framework": "^3.3.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
"@

Set-Content -Path "$tempDir\package.json" -Value $packageJson

# Create index.js with a minimal HTTP function
$indexJs = @"
const functions = require('@google-cloud/functions-framework');

// Register an HTTP function
functions.http('handler', (req, res) => {
  console.log('Placeholder function invoked');
  res.status(200).json({
    status: 'placeholder',
    message: 'This is a placeholder function. Please deploy the actual implementation.'
  });
});

// Also handle Pub/Sub events
functions.cloudEvent('handler', (cloudEvent) => {
  console.log('Placeholder function invoked via Pub/Sub');
  console.log('Event:', JSON.stringify(cloudEvent));
});
"@

Set-Content -Path "$tempDir\index.js" -Value $indexJs

# Create ZIP file
Write-Host "[*] Creating ZIP file..." -ForegroundColor Cyan
if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Force
}

# Use PowerShell's Compress-Archive
Compress-Archive -Path "$tempDir\*" -DestinationPath $OutputPath -Force

# Clean up temp directory
Remove-Item $tempDir -Recurse -Force

Write-Host "[+] Placeholder function created: $OutputPath" -ForegroundColor Green
Write-Host ""
Write-Host "File size: $((Get-Item $OutputPath).Length) bytes" -ForegroundColor Gray
