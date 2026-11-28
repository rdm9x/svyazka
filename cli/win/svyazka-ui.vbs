' Opens the Keyhandoff (Связка) UI without a console window (Start menu shortcut target)
Set sh = CreateObject("WScript.Shell")
cmd = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.svyazka\bin\svyazka.cmd"
sh.Run """" & cmd & """ ui", 0, False
