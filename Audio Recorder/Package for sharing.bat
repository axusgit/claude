@echo off
REM Builds a clean ZIP to share with colleagues.
REM Includes only the app + setup files. EXCLUDES your personal data:
REM   config.json (your HuggingFace token + mic choice), recordings, transcripts.
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
  "$src='%~dp0'.TrimEnd('\'); $dst=Join-Path ([Environment]::GetFolderPath('Desktop')) 'AudioRecorder_share.zip'; if(Test-Path $dst){Remove-Item $dst -Force}; $names=@('app.py','Launch Audio Recorder.vbs','recorder_icon.ico','requirements.txt','README.md','setup.ps1','Setup.bat','autostart.ps1','Enable auto-start.bat','Disable auto-start.bat'); $items=$names | ForEach-Object { Join-Path $src $_ } | Where-Object { Test-Path $_ }; Compress-Archive -Path $items -DestinationPath $dst -Force; Write-Host ''; Write-Host ('Created: ' + $dst) -ForegroundColor Green; Write-Host 'Send that ZIP to a colleague. They unzip it and run Setup.bat, then Launch Audio Recorder.vbs.'"
echo.
pause
