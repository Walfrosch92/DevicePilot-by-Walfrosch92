' start-hidden.vbs
' Startet bridge.js via node.exe ohne sichtbares Konsolenfenster.
' Wird vom Windows Task Scheduler als Aktion verwendet.

Dim oShell, strDir
Set oShell = CreateObject("WScript.Shell")

' Verzeichnis dieser .vbs-Datei = native\
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Fensterstil 0 = versteckt, False = nicht warten (fire-and-forget)
oShell.Run "node """ & strDir & "bridge.js""", 0, False
