param(
  [string]$anchor,
  [string]$prompt
)

$logDir = Join-Path $env:USERPROFILE ".claude-anchors\logs"
$logFile = Join-Path $logDir "$anchor.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Create log directory if it doesn't exist
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

"=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = "$env:APPDATA\npm\claude.cmd" }

& $claude -p $prompt 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
