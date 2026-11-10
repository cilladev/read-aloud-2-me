# Builds Read Aloud 2 Me from source and installs it into VS Code (Windows).
# Usage: .\install.ps1            installs into VS Code
#        .\install.ps1 cursor     installs into another editors CLI, e.g. cursor, windsurf, codium
param([string]$EditorCli = "code")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 22 or later is needed: https://nodejs.org"
}
if (-not (Get-Command $EditorCli -ErrorAction SilentlyContinue)) {
  Write-Error "The $EditorCli command isnt on your PATH. Reinstall VS Code with Add to PATH ticked."
}

Write-Host "Installing dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Building..."
npm run vsix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Installing into $EditorCli..."
& $EditorCli --install-extension read-aloud-2-me.vsix --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Reload the editor window to start using Read Aloud 2 Me."
