@echo off
REM Drag an .mp4 onto this file to transcribe it.
if "%~1"=="" (
    echo Drag a video file onto this .bat, or run:
    echo    python transcribe.py "your video.mp4"
    pause
    exit /b
)
python "%~dp0transcribe.py" %*
echo.
pause
