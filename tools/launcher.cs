// "MLBB Overlay Server.exe": a named launcher for server.ps1, in place of the
// batch file. It gives the window a title and a banner, and the file a
// product name and publisher in its Properties. Rebuild it with
// tools\build-launcher.ps1; change the names there, not here.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("MLBB Overlay Server")]
[assembly: AssemblyDescription("Starts the local server for the MLBB tournament overlays")]
[assembly: AssemblyProduct("MLBB Overlay")]
[assembly: AssemblyCompany(Launcher.Publisher)]
[assembly: AssemblyCopyright("Copyright (c) 2026 " + Launcher.Publisher)]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    public const string Publisher = "Dru Loloy";
    const string Name = "MLBB Overlay Server";

    static int Main(string[] args)
    {
        Console.Title = Name;
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(dir, "server.ps1");

        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine();
        Console.WriteLine("  " + Name);
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.WriteLine("  by " + Publisher);
        Console.ResetColor();

        if (!File.Exists(script))
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("  server.ps1 was not found next to this program.");
            Console.WriteLine("  Keep this file in the overlay folder, beside control.html.");
            Console.ResetColor();
            return Wait(1);
        }

        string extra = args.Length > 0 ? " " + string.Join(" ", args) : "";
        ProcessStartInfo start = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + extra);
        start.UseShellExecute = false;      // share this window
        start.WorkingDirectory = dir;

        // Ctrl+C stops the server; this program stays to show how it ended.
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };

        int code;
        try
        {
            using (Process server = Process.Start(start))
            {
                server.WaitForExit();
                code = server.ExitCode;
            }
        }
        catch (Exception problem)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("  Could not start Windows PowerShell: " + problem.Message);
            Console.ResetColor();
            code = 1;
        }
        return Wait(code);
    }

    static int Wait(int code)
    {
        Console.WriteLine();
        Console.Write("  The server has stopped. Press any key to close this window . . . ");
        try { Console.ReadKey(true); } catch (InvalidOperationException) { }
        return code;
    }
}
