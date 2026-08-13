' Launches a PowerShell script with NO visible window.
' Usage: wscript.exe run-hidden.vbs "C:\path\to\script.ps1"
' Window style 0 = hidden; runs in the current (logged-on) session so
' git / DPAPI credentials remain accessible.
Set args = WScript.Arguments
If args.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NonInteractive -ExecutionPolicy Bypass -File """ & args(0) & """"
sh.Run cmd, 0, False
