"""Создаёт ярлыки «ИИ-наставник» на рабочем столе и в меню «Пуск» (Windows).

Запуск: python desktop/install_shortcut.py   (или install_desktop.bat)
Ярлык запускает desktop/launcher.pyw через pythonw.exe — без консольного окна.
"""
import base64
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    if os.name != "nt":
        print("Ярлыки создаются только в Windows. На Linux/macOS запускайте: python desktop/launcher.pyw")
        return 1
    icon = os.path.join(HERE, "icon.ico")
    if not os.path.exists(icon):
        sys.path.insert(0, HERE)
        import make_icon
        make_icon.build_ico(icon)
    exe = sys.executable
    pythonw = os.path.join(os.path.dirname(exe), "pythonw.exe")
    if not os.path.exists(pythonw):
        pythonw = exe
    launcher = os.path.join(HERE, "launcher.pyw")

    def ps_str(s):
        return "'" + s.replace("'", "''") + "'"

    script = f"""
$shell = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($d in $dirs) {{
  $p = Join-Path $d 'ИИ-наставник.lnk'
  $l = $shell.CreateShortcut($p)
  $l.TargetPath = {ps_str(pythonw)}
  $l.Arguments = {ps_str('"' + launcher + '"')}
  $l.WorkingDirectory = {ps_str(ROOT)}
  $l.IconLocation = {ps_str(icon + ',0')}
  $l.Description = 'ИИ-наставник: универсальный ИИ-агент и учебная платформа по программированию'
  $l.Save()
  [Console]::Out.WriteLine($p)
}}
"""
    enc = base64.b64encode(script.encode("utf-16-le")).decode()
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc],
                       capture_output=True)
    out = r.stdout.decode("utf-8", "replace") if r.stdout else ""
    if r.returncode != 0:
        print("Не удалось создать ярлык:", r.stderr.decode("cp866", "replace"))
        return 1
    print("Ярлыки созданы (рабочий стол и меню «Пуск»). Запуск через:", pythonw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
