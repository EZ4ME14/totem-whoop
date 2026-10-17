# Commit and push the code (never secrets or health data) to GitHub.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .git)) { git init -b main | Out-Null }
git config user.name 'EZ4ME14'
git config user.email 'EZ4ME14@users.noreply.github.com'
git add -A
$tracked = git diff --cached --name-only
$bad = $tracked | Where-Object { $_ -match '(^|/)\.env' -and $_ -ne '.env.example' -or $_ -match '^reports/' -or $_ -match 'whoop-report' -or $_ -match '^\.claude/' }
if ($bad) { git reset -q; throw ('Refusing to commit: ' + ($bad -join ', ')) }
Write-Host ('Files staged: ' + @($tracked).Count)
git commit -q -m 'Totem 1.5.1 + Upstash token store, cross-process token adoption, Render/HF deploy scripts'
if (-not (git remote)) { git remote add origin https://github.com/EZ4ME14/totem-whoop.git }
git push -u origin main
Write-Host '== PUSHED'
