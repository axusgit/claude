param([ValidateSet('enable','disable')][string]$Mode = 'enable')

$dir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Audio Recorder.lnk'

if ($Mode -eq 'enable') {
    $ws  = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath       = 'wscript.exe'
    $lnk.Arguments        = '"' + (Join-Path $dir 'Launch Audio Recorder.vbs') + '"'
    $lnk.WorkingDirectory = $dir
    $lnk.IconLocation     = (Join-Path $dir 'recorder_icon.ico')
    $lnk.Description       = 'Audio Recorder'
    $lnk.Save()
    Write-Host "Auto-start ENABLED. The app launches automatically at Windows login" -ForegroundColor Green
    Write-Host "and lives in the system tray (red 'R')."
} else {
    if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }
    Write-Host "Auto-start DISABLED." -ForegroundColor Yellow
}
