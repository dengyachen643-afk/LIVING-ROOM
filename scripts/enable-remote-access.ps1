param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8787
)

$tailscaleCandidates = @(
  (Get-Command tailscale -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  "C:\Program Files\Tailscale\tailscale.exe",
  "C:\Program Files (x86)\Tailscale\tailscale.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$tailscaleExe = $tailscaleCandidates | Select-Object -First 1
if (-not $tailscaleExe) {
  Write-Error "Tailscale was not found. Install it with: winget install --id Tailscale.Tailscale"
  exit 1
}

& $tailscaleExe status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Tailscale is logged out. Open Tailscale from the Windows system tray and sign in first."
  exit 1
}

Write-Host "Publishing http://127.0.0.1:$Port through a persistent HTTPS Funnel..."
& $tailscaleExe funnel --bg $Port
if ($LASTEXITCODE -ne 0) {
  Write-Error "Funnel failed. On first use, approve Funnel in the opened web page and retry."
  exit $LASTEXITCODE
}

Write-Host "Remote access is enabled. Use the HTTPS address below for your phone and ChatGPT Action:"
& $tailscaleExe funnel status
