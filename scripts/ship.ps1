# Build, test, commit and push (Render auto-deploys from GitHub). Prints no secrets.
param([string]$Message = 'Update')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
npx tsc
if ($LASTEXITCODE -ne 0) { throw 'tsc failed' }
$ErrorActionPreference = 'Continue'
cmd /c "npx vitest run --reporter=dot 2>&1" | Select-Object -Last 6
$ErrorActionPreference = 'Stop'
git add -A
$bad = git diff --cached --name-only | Where-Object { ($_ -match '(^|/)\.env' -and $_ -ne '.env.example') -or $_ -match '^reports/' -or $_ -match '^\.claude/' }
if ($bad) { git reset -q; throw ('Refusing to commit: ' + ($bad -join ', ')) }
git commit -q -m $Message
git push -q origin main
Write-Host '== SHIPPED'
