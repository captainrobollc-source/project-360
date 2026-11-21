' Project 360 shell launcher (used when "Console shell mode" replaces explorer.exe).
' Runs the dashboard and guarantees a way back to Windows:
'   exit code 65 -> relaunch the dashboard (restart / restore backup)
'   exit code 64 -> user chose "Exit to Windows Desktop" (explorer already started)
'   exit code 0  -> normal quit: start explorer.exe
'   anything else -> crash (or a hang the watchdog killed): relaunch, up to 3 times in
'                    10 minutes, then start explorer.exe so you never get a black screen
Option Explicit
Dim sh, args, cmd, i, rc, crashes(), n, t, recent, k
Set sh = CreateObject("WScript.Shell")
Set args = WScript.Arguments
If args.Count = 0 Then
  sh.Run "explorer.exe", 1, False
  WScript.Quit 1
End If

cmd = ""
For i = 0 To args.Count - 1
  cmd = cmd & """" & args(i) & """ "
Next
cmd = cmd & "--shell"

n = 0
ReDim crashes(0)
Do
  rc = sh.Run(cmd, 1, True)
  If rc = 65 Then
    ' restart requested
  ElseIf rc = 64 Then
    WScript.Quit 0
  ElseIf rc = 0 Then
    Exit Do
  Else
    ' crash: count the ones in the last 10 minutes
    t = Now
    recent = 0
    For k = 0 To n - 1
      If DateDiff("s", crashes(k), t) < 600 Then recent = recent + 1
    Next
    ReDim Preserve crashes(n)
    crashes(n) = t
    n = n + 1
    If recent >= 3 Then Exit Do
    cmd = Replace(cmd, " --recovered", "") & " --recovered"
  End If
Loop

sh.Run "explorer.exe", 1, False
