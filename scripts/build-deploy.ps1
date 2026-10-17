# Build + test + deploy Totem to Hugging Face. Prints no secrets.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host '== build'
npx tsc
if ($LASTEXITCODE -ne 0) { throw 'tsc failed' }
Write-Host '== tests'
npx vitest run --reporter=dot
Write-Host '== deploy'
node scripts/deploy-hf.mjs
if ($LASTEXITCODE -ne 0) { throw 'deploy failed' }
Write-Host '== local check via shared Upstash store'
node scripts/mcp-call.mjs whoop_live_state '{}'
Write-Host '== DONE'
