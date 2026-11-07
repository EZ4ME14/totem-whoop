# Poll a URL's /health until 200 (max ~12 min).
param([string]$Url = 'https://totem-whoop.onrender.com')
for ($i = 0; $i -lt 72; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 "$Url/health"
    if ($r.StatusCode -eq 200) { Write-Host "HEALTH_OK after $($i*10)s: $($r.Content)"; exit 0 }
  } catch { }
  Start-Sleep -Seconds 10
}
Write-Host 'HEALTH_TIMEOUT'; exit 1
