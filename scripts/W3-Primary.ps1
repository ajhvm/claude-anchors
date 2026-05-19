$logFile = "$env:USERPROFILE\ClaudeAnchors\logs\W3-Primary.log"
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = "$env:APPDATA\npm\claude.cmd" }
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"=== $timestamp ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
$em = [char]0x2014
& $claude -p "Window 3 open $em 3pm block. Reply OK only." 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
