// "MLBB-Overlay-Setup.exe": the whole overlay in one file, for a GitHub
// release. It unpacks the project into a folder, puts a shortcut on the
// desktop and offers to start the server. Run again over an existing install
// it replaces the program files and keeps the data folder (match and season).
// Built by tools\build-release.ps1, which embeds the project as payload.zip.
//
//   MLBB-Overlay-Setup.exe                 asks where to install
//   MLBB-Overlay-Setup.exe "D:\Overlay"    installs there
//   MLBB-Overlay-Setup.exe /quiet [folder] no questions, no shortcut, no start
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

[assembly: AssemblyTitle("MLBB Overlay Setup")]
[assembly: AssemblyDescription("Installs the MLBB tournament overlays and their control panel")]
[assembly: AssemblyProduct("MLBB Overlay")]
[assembly: AssemblyCompany(Setup.Publisher)]
[assembly: AssemblyCopyright("Copyright (c) 2026 " + Setup.Publisher)]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Setup
{
    public const string Publisher = "druloloy";
    public const string Version = "1.0.0";
    const string Launcher = "MLBB Overlay Server.exe";

    static void Say(string text, ConsoleColor color)
    {
        Console.ForegroundColor = color;
        Console.WriteLine("  " + text);
        Console.ResetColor();
    }

    static int Main(string[] args)
    {
        bool quiet = false;
        string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MLBB Overlay");
        foreach (string arg in args)
        {
            if (arg.Equals("/quiet", StringComparison.OrdinalIgnoreCase)) quiet = true;
            else folder = arg;
        }

        try { Console.Title = "MLBB Overlay Setup"; } catch (IOException) { }
        Console.WriteLine();
        Say("MLBB Overlay  " + Version, ConsoleColor.Yellow);
        Say("by " + Publisher, ConsoleColor.DarkGray);
        Console.WriteLine();

        if (!quiet)
        {
            Say("Where should it be installed? Press Enter for:", ConsoleColor.Gray);
            Say("  " + folder, ConsoleColor.White);
            Console.Write("  Folder: ");
            string typed = (Console.ReadLine() ?? "").Trim().Trim('"');
            if (typed.Length > 0) folder = typed;
            Console.WriteLine();
        }

        int code = Install(folder, quiet);
        if (!quiet)
        {
            Console.WriteLine();
            Console.Write("  Press any key to close this window . . . ");
            try { Console.ReadKey(true); } catch (InvalidOperationException) { }
        }
        return code;
    }

    static int Install(string folder, bool quiet)
    {
        int written = 0, kept = 0;
        try
        {
            folder = Path.GetFullPath(folder);
            bool existing = File.Exists(Path.Combine(folder, "server.ps1"));
            Directory.CreateDirectory(folder);
            string root = folder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            {
                if (payload == null) throw new InvalidOperationException("This setup file is incomplete (no payload).");
                using (ZipArchive zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in zip.Entries)
                    {
                        if (entry.FullName.EndsWith("/")) continue;
                        string target = Path.GetFullPath(Path.Combine(folder, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;   // never outside the folder
                        // an existing match and season are yours: leave them alone
                        if (entry.FullName.StartsWith("data/", StringComparison.OrdinalIgnoreCase) && File.Exists(target)) { kept++; continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                        written++;
                        if (written % 25 == 0) Console.Write("\r  Unpacking " + written + " files   ");
                    }
                }
            }
            Console.Write("\r                                   \r");
            Say((existing ? "Updated the overlay in" : "Installed to"), ConsoleColor.Green);
            Say("  " + folder, ConsoleColor.White);
            Say(written + " files written" + (kept > 0 ? ", your match and season kept." : "."), ConsoleColor.Gray);
        }
        catch (IOException problem)
        {
            Console.WriteLine();
            Say("Could not write a file: " + problem.Message, ConsoleColor.Red);
            Say("If the overlay server is running from that folder, close it and run this again.", ConsoleColor.Gray);
            return 1;
        }
        catch (Exception problem)
        {
            Console.WriteLine();
            Say("Setup did not finish: " + problem.Message, ConsoleColor.Red);
            return 1;
        }

        if (quiet) return 0;

        string launcher = Path.Combine(folder, Launcher);
        try
        {
            // a desktop shortcut, through the Windows scripting shell
            string link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "MLBB Overlay Server.lnk");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type st = shortcut.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { launcher });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { folder });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Start the MLBB overlay server" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            Say("A shortcut \"MLBB Overlay Server\" is on your desktop.", ConsoleColor.Gray);
        }
        catch (Exception)
        {
            Say("(No desktop shortcut was made; start it from the folder above.)", ConsoleColor.DarkGray);
        }

        Console.WriteLine();
        Console.Write("  Start the overlay server now?  [Y] yes   [N] no : ");
        string answer = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
        if (answer.Length == 0 || answer.StartsWith("y"))
        {
            ProcessStartInfo start = new ProcessStartInfo(launcher);
            start.WorkingDirectory = folder;
            start.UseShellExecute = true;       // its own window
            Process.Start(start);
            Say("Started. The control panel opens in your browser.", ConsoleColor.Green);
        }
        return 0;
    }
}
