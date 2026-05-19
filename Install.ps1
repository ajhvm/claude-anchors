# Install.ps1 — registers all 8 ClaudeAnchor tasks (no elevation required)
# For run-without-login support, also run Elevate-ClaudeAnchors.ps1 as admin.

$base      = "$env:USERPROFILE\ClaudeAnchors"
$scriptDir = "$base\scripts"
$logDir    = "$base\logs"

# Auto-discover claude; fall back to npm global path
$claudePath = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claudePath) {
    $claudePath = "$env:APPDATA\npm\claude.cmd"
}
if (-not (Test-Path $claudePath)) {
    Write-Error "claude not found. Install it with: npm install -g @anthropic-ai/claude-code"
    exit 1
}
Write-Host "Using claude: $claudePath"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$userId = "$env:USERDOMAIN\$env:USERNAME"

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
        -LogonType Interactive `
        -RunLevel Limited

    $fullName = "ClaudeAnchor-$($t.Name)"
    Register-ScheduledTask `
        -TaskName $fullName `
        -TaskPath "\" `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Force -ErrorAction Stop | Out-Null

    Write-Host "Registered: $fullName @ $timeStr"
}

Write-Host ""
Write-Host "Done. Run Elevate-ClaudeAnchors.ps1 as admin for run-without-login support."
