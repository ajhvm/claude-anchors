$logFile = "$env:USERPROFILE\ClaudeAnchors\logs\W1-Backup.log"
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = "$env:APPDATA\npm\claude.cmd" }
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
$em = [char]0x2014
& $claude -p "Window 1 open $em 5am block. Reply OK only." 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
