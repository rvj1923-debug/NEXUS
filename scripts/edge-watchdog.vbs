' Company Phone Tracker - Zero-Window Wrapper for Edge Watchdog
' Runs in the kiosk user session every 2 minutes via wscript.exe (GUI subsystem).
' Uses conhost.exe --headless and WshShell.Run window style 0 so no console window
' is ever created or flashed, preserving keyboard-wedge focus in Microsoft Edge.

Option Explicit

Dim fso, scriptDir, psScript, wshShell, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "edge-watchdog.ps1")

Set wshShell = CreateObject("WScript.Shell")
cmd = "conhost.exe --headless powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & psScript & """"

On Error Resume Next
wshShell.Run cmd, 0, False
If Err.Number <> 0 Then
    Err.Clear
    cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & psScript & """"
    wshShell.Run cmd, 0, False
End If
On Error GoTo 0
