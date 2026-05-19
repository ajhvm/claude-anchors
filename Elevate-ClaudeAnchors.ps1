#Requires -RunAsAdministrator
# Run once as admin to:
#   1. Create \ClaudeAnchors\ folder in Task Scheduler
#   2. Re-register all tasks under \ClaudeAnchors\ with S4U (run without login)
#      + RunLevel Highest + WakeToRun
#   3. Remove the temporary root-level Interactive tasks

$base     = "$env:USERPROFILE\ClaudeAnchors"
$claude   = "C:\Users\aj\AppData\Roaming\npm\claude.cmd"
$scriptDir = "$base\scripts"
$userId   = "$env:USERDOMAIN\$env:USERNAME"

$taskDefs = @(
    @{ Name="W1-Primary"; Hour=4;  Min=55 },
    @{ Name="W2-Primary"; Hour=10; Min=1  },
    @{ Name="W3-Primary"; Hour=15; Min=5  },
    @{ Name="W4-Primary"; Hour=20; Min=10 },
    @{ Name="W1-Backup";  Hour=5;  Min=10 },
    @{ Name="W2-Backup";  Hour=10; Min=15 },
    @{ Name="W3-Backup";  Hour=15; Min=20 },
    @{ Name="W4-Backup";  Hour=20; Min=25 }
)

# Create \ClaudeAnchors\ folder via COM (requires admin)
$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$root = $svc.GetFolder("\")
try   { $root.GetFolder("ClaudeAnchors") | Out-Null; Write-Host "Folder already exists" }
catch { $root.CreateFolder("ClaudeAnchors") | Out-Null; Write-Host "Created \ClaudeAnchors\ folder" }

foreach ($t in $taskDefs) {
    $scriptFile = "$scriptDir\$($t.Name).ps1"
    $timeStr    = "{0}:{1:D2}" -f $t.Hour, $t.Min

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptFile`""

    $trigger = New-ScheduledTaskTrigger -Daily -At $timeStr

    $settings = New-ScheduledTaskSettingsSet `
        -WakeToRun `
        -MultipleInstances IgnoreNew `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -StartWhenAvailable

    $principal = New-ScheduledTaskPrincipal `
        -UserId $userId `
        -LogonType S4U `
        -RunLevel Highest

    Register-ScheduledTask `
        -TaskName $t.Name `
        -TaskPath "\ClaudeAnchors\" `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force -ErrorAction Stop | Out-Null

    # Remove old root-level task
    Unregister-ScheduledTask -TaskName "ClaudeAnchor-$($t.Name)" -Confirm:$false -ErrorAction SilentlyContinue

    Write-Host "OK  \ClaudeAnchors\$($t.Name)  @ $timeStr"
}

Write-Host ""
Write-Host "Done. All tasks now under \ClaudeAnchors\ with S4U logon (run without login)."
