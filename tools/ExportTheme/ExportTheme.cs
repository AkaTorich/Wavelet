// Переносит тему «Киберпанк» из ThemeLibrary в Wavelet: один файл CSS с переменными --tl-*
// (app\ui\css\theme.css). Библиотека только читается (ThemeLibrary.dll, WebTheme.Css).
// Сборка и запуск — tools\export-theme.ps1.

using System;
using System.IO;
using System.Linq;
using System.Text;
using ThemeLibrary;

static class ExportTheme
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("ExportTheme <файл.css> <id темы>"); return 2; }
        if (System.Windows.Application.Current == null) new System.Windows.Application();
        var theme = Themes.All.FirstOrDefault(t => string.Equals(t.Id, args[1], StringComparison.OrdinalIgnoreCase));
        if (theme == null) { Console.Error.WriteLine("нет темы " + args[1]); return 1; }
        File.WriteAllText(args[0], WebTheme.Css(theme), new UTF8Encoding(false));
        Console.WriteLine("тема: " + theme.Name);
        return 0;
    }
}
