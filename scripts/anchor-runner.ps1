param(
  [string]$anchor,
  [string]$scheduledTime
)

$configFile = Join-Path $env:USERPROFILE ".claude-anchors\config.json"
$logDir = Join-Path $env:USERPROFILE ".claude-anchors\logs"
$logFile = Join-Path $logDir "$anchor.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$windowDuration = 5
$prompt = "New context window open. Reply OK only."
try {
  $config = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -ne $config.windowDuration) { $windowDuration = [int]$config.windowDuration }
  if ($config.prompt) { $prompt = $config.prompt }
} catch {
  Write-Error "Failed to read config: $_"
}

$today = Get-Date -Format "yyyy-MM-dd"
try {
  $windowStart = [datetime]::ParseExact("$today $scheduledTime", "yyyy-MM-dd HH:mm", $null)
  $windowEnd = $windowStart.AddHours($windowDuration)
  if ((Get-Date) -gt $windowEnd) {
    "=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
    "SKIPPED: Window expired" | Out-File -FilePath $logFile -Append -Encoding UTF8
    "" | Out-File -FilePath $logFile -Append -Encoding UTF8
    exit 0
  }
} catch {
  Write-Error "Failed to parse scheduledTime '$scheduledTime': $_"
}

"=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = "$env:APPDATA\npm\claude.cmd" }

& $claude -p "$prompt" 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
"" | Out-File -FilePath $logFile -Append -Encoding UTF8
