' Volme3D Print Helper - startet den Dienst UNSICHTBAR (ohne Konsolenfenster).
' Diese Datei in den Autostart legen:  Win+R  ->  shell:startup  ->  hier reinkopieren
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' pythonw startet Python ohne Konsolenfenster; 0 = verstecktes Fenster
sh.Run "pythonw """ & dir & "\volme3d-print-helper.py""", 0, False
