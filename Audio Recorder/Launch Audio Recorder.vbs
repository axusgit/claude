' Launches the Audio Recorder GUI with no console window.
Dim fso, sh, scriptDir, pythonw
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = "C:\Users\Andy\AppData\Local\Programs\Python\Python313\pythonw.exe"
If Not fso.FileExists(pythonw) Then pythonw = "pythonw.exe"  ' fall back to PATH
sh.CurrentDirectory = scriptDir
' 0 = hidden window, False = don't wait
sh.Run """" & pythonw & """ """ & scriptDir & "\app.py""", 0, False
