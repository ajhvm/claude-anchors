# Remove ALL Claude Anchors scheduled tasks (both generations).
# Run once, elevated:  powershell -ExecutionPolicy Bypass -File .\Remove-AnchorTasks.ps1
# The redesigned tray app creates zero tasks, so this is a one-time cleanup.

$ErrorActionPreference = 'Continue'
$removed = @()
$failed = @()

$targets = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  $_.TaskName -like 'ClaudeAnchor-*' -or
  ($_.TaskPath -like '\ClaudeAnchors\*') -or
  ($_.TaskName -match '^W[1-4]-(Primary|Backup)$')
}

foreach ($t in $targets) {
  $full = "$($t.TaskPath)$($t.TaskName)"
  try {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop
    $removed += $full
  } catch {
    $failed += "${full}: $($_.Exception.Message)"
  }
}

Write-Output "Removed $($removed.Count) task(s):"
$removed | ForEach-Object { Write-Output "  $_" }
if ($failed.Count -gt 0) {
  Write-Output "Failed ($($failed.Count)):"
  $failed | ForEach-Object { Write-Output "  $_" }
}
