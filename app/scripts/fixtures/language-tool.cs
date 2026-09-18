using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

// Native Windows equivalents of the POSIX tools in test-code-editor-ui.mjs.
class LanguageToolFixture
{
    public class Overlay
    {
        public List<Dictionary<string, string>> roots { get; set; }
    }

    static int Main(string[] args)
    {
        bool ruff = Path.GetFileNameWithoutExtension(
            System.Reflection.Assembly.GetExecutingAssembly().Location) == "ruff";
        if (Array.IndexOf(args, "--version") >= 0)
        {
            Console.WriteLine(ruff ? "ruff 0.9.0" : "clang-tidy version 20");
            return 0;
        }
        if (ruff)
        {
            if (args[0] == "format")
            {
                Console.Write(Console.In.ReadToEnd().Replace("answer = value + 1", "answer = value + 2"));
                return 0;
            }
            Console.Write("[{\"code\":\"W001\",\"message\":\"example warning\",\"location\":{\"row\":1,\"column\":1}}]");
            return 1;
        }
        string overlayArgument = Array.Find(args, arg => arg.StartsWith("--vfsoverlay="));
        var overlay = new JavaScriptSerializer().Deserialize<Overlay>(
            File.ReadAllText(overlayArgument.Substring(13)));
        if (File.ReadAllText(overlay.roots[0]["external-contents"]).Contains("unsaved_warning"))
            Console.WriteLine(args[0] + ":1:1: warning: live C++ warning [live-check]");
        return 0;
    }
}
