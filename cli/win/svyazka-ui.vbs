' Opens Svyazka UI without a console window (Start menu shortcut target)
Set sh = CreateObject("WScript.Shell")
app = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.svyazka\app\cli\svyazka.mjs"
sh.Run "node """ & app & """ ui", 0, False
