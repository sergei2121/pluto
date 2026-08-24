// ─── PLUTO Agent для Windows (C#, .NET Framework 4.5+) ─────────────────────
// Компилируется ПРЯМО НА МАШИНЕ встроенным компилятором csc.exe, поэтому всегда
// получается под правильную архитектуру — ошибки «не является приложением» нет.
//
// Ручная сборка (если нужно):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe ^
//     /out:pluto-agent.exe /reference:System.Management.dll ^
//     /reference:System.ServiceProcess.dll /reference:System.Net.Http.dll PlutoAgent.cs
//
// Запуск:  pluto-agent.exe -server ws://IP:8443/ws -token ТОКЕН
// Служба:  создаётся установщиком (install.ps1), exe умеет работать и службой, и в консоли.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.WebSockets;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

static class Json
{
    public static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}

static class Collector
{
    static PerformanceCounter _cpu;

    public static Dictionary<string, object> Metrics()
    {
        var m = new Dictionary<string, object>();

        // ── ЦП ──
        double cpu = 0;
        try
        {
            if (_cpu == null) _cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total");
            cpu = Math.Round(_cpu.NextValue(), 1);
        }
        catch { }
        m["cpuLoad"] = cpu;
        m["cpuCores"] = Environment.ProcessorCount;
        m["cpuTemp"] = WmiTemp();

        // ── ОЗУ ──
        double ramTotal = 0, ramUsed = 0;
        try
        {
            using (var s = new ManagementObjectSearcher("SELECT TotalVisibleMemorySize,FreePhysicalMemory FROM Win32_OperatingSystem"))
            foreach (ManagementObject o in s.Get())
            {
                double totKb = Convert.ToDouble(o["TotalVisibleMemorySize"]);
                double freeKb = Convert.ToDouble(o["FreePhysicalMemory"]);
                ramTotal = totKb * 1024;
                ramUsed = (totKb - freeKb) * 1024;
            }
        }
        catch { }
        m["ramTotal"] = ramTotal;
        m["ramUsed"] = ramUsed;
        m["ramTemp"] = 0;

        // ── Диски ──
        var disks = new List<string>();
        foreach (DriveInfo d in DriveInfo.GetDrives())
        {
            if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
            disks.Add(string.Format("{{\"label\":\"{0}\",\"total\":{1},\"used\":{2},\"temp\":0}}",
                Json.Esc(d.Name.TrimEnd('\\')), d.TotalSize, d.TotalSize - d.TotalFreeSpace));
        }
        m["__disks"] = "[" + string.Join(",", disks) + "]";

        // ── Сеть ──
        double rx = 0, tx = 0;
        try
        {
            var cat = new PerformanceCounterCategory("Network Interface");
            foreach (string inst in cat.GetInstanceNames())
            {
                try
                {
                    using (var r = new PerformanceCounter("Network Interface", "Bytes Received/sec", inst))
                    using (var t = new PerformanceCounter("Network Interface", "Bytes Sent/sec", inst))
                    {
                        rx += r.NextValue();
                        tx += t.NextValue();
                    }
                }
                catch { }
            }
        }
        catch { }
        m["rxRate"] = Math.Round(rx / 1024, 1);
        m["txRate"] = Math.Round(tx / 1024, 1);

        return m;
    }

    static double WmiTemp()
    {
        try
        {
            using (var s = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature"))
            foreach (ManagementObject o in s.Get())
                return Math.Round(Convert.ToDouble(o["CurrentTemperature"]) / 10.0 - 273.15, 1);
        }
        catch { }
        return 0;
    }

    public static string MetricsJson(Dictionary<string, object> m)
    {
        var sb = new StringBuilder();
        sb.Append("{");
        bool first = true;
        foreach (var kv in m)
        {
            if (!first) sb.Append(",");
            first = false;
            if (kv.Key == "__disks") sb.AppendFormat("\"disks\":{0}", kv.Value);
            else sb.AppendFormat("\"{0}\":{1}", kv.Key, kv.Value);
        }
        sb.Append("}");
        return sb.ToString();
    }

    public static string LanJson()
    {
        var sb = new StringBuilder("[");
        bool firstNet = true;
        try
        {
            var arp = RunArp();
            foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                foreach (UnicastIPAddressInformation ip in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ip.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                    string cidr = ip.Address + "/" + (ip.IPv4Mask != null ? MaskToLen(ip.IPv4Mask) : 24);
                    if (!firstNet) sb.Append(",");
                    firstNet = false;
                    sb.AppendFormat("{{\"cidr\":\"{0}\",\"iface\":\"{1}\",\"hosts\":{2}}}",
                        cidr, Json.Esc(ni.Name), arp);
                }
            }
        }
        catch { }
        sb.Append("]");
        return sb.ToString();
    }

    static int MaskToLen(IPAddress mask)
    {
        byte[] b = mask.GetAddressBytes();
        int bits = 0;
        foreach (byte x in b) { int v = x; while (v != 0) { bits += v & 1; v >>= 1; } }
        return bits;
    }

    static string RunArp()
    {
        var hosts = new List<string>();
        try
        {
            var psi = new ProcessStartInfo("arp", "-a");
            psi.RedirectStandardOutput = true;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            using (var pr = Process.Start(psi))
            {
                string line;
                while ((line = pr.StandardOutput.ReadLine()) != null)
                {
                    string[] f = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (f.Length >= 2 && f[0].Contains(".") && f[1].Contains("-"))
                        hosts.Add(string.Format("{{\"ip\":\"{0}\",\"mac\":\"{1}\",\"online\":true}}", f[0], f[1]));
                }
                pr.WaitForExit(2000);
            }
        }
        catch { }
        return "[" + string.Join(",", hosts) + "]";
    }
}

class Worker
{
    readonly string _server;
    readonly string _token;
    readonly int _metricsSec;
    readonly int _lanSec;
    readonly ManualResetEvent _stop = new ManualResetEvent(false);

    public Worker(string server, string token, int metricsSec, int lanSec)
    {
        _server = server; _token = token; _metricsSec = metricsSec; _lanSec = lanSec;
    }

    public void Stop() { _stop.Set(); }

    public void Run()
    {
        while (!_stop.WaitOne(0))
        {
            try { Loop(); }
            catch (Exception e) { Log("ошибка: " + e.Message); }
            if (!_stop.WaitOne(0)) { Log("переподключение через 5 с…"); _stop.WaitOne(5000); }
        }
    }

    async void Loop()
    {
        using (var ws = new ClientWebSocket())
        {
            string url = _server + (_server.Contains("?") ? "&" : "?") + "token=" + Uri.EscapeDataString(_token);
            await ws.ConnectAsync(new Uri(url), CancellationToken.None);
            Log("подключено к " + _server);

            string hello = "{\"type\":\"hello\",\"hostname\":\"" + Json.Esc(Environment.MachineName) +
                           "\",\"os\":\"Windows\",\"version\":\"1.7.0-cs\"}";
            await Send(ws, hello);

            int lanCounter = _lanSec; // отправить LAN сразу при старте
            while (ws.State == WebSocketState.Open && !_stop.WaitOne(0))
            {
                var m = Collector.Metrics();
                await Send(ws, "{\"type\":\"metrics\",\"data\":" + Collector.MetricsJson(m) + "}");

                lanCounter -= _metricsSec;
                if (lanCounter <= 0)
                {
                    lanCounter = _lanSec;
                    await Send(ws, "{\"type\":\"lan\",\"networks\":" + Collector.LanJson() + "}");
                }
                _stop.WaitOne(_metricsSec * 1000);
            }
        }
    }

    async Task Send(ClientWebSocket ws, string text)
    {
        var buf = new ArraySegment<byte>(Encoding.UTF8.GetBytes(text));
        await ws.SendAsync(buf, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    static void Log(string s)
    {
        try { Console.WriteLine("[pluto-agent] " + s); } catch { }
        try
        {
            string dir = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData) + "\\pluto";
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(dir + "\\agent.log", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + s + "\r\n");
        }
        catch { }
    }
}

class PlutoService : ServiceBase
{
    Worker _w;
    public PlutoService() { ServiceName = "pluto-agent"; CanStop = true; }

    protected override void OnStart(string[] args)
    {
        var o = Options.From(args);
        _w = new Worker(o.Server, o.Token, o.Metrics, o.Lan);
        new Thread(_w.Run) { IsBackground = true }.Start();
    }
    protected override void OnStop() { if (_w != null) _w.Stop(); }
}

class Options
{
    public string Server = "ws://127.0.0.1:8443/ws";
    public string Token = "";
    public int Metrics = 3;
    public int Lan = 300;

    public static Options From(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length - 1; i++)
        {
            string k = args[i].TrimStart('-');
            string v = args[i + 1];
            if (k == "server") o.Server = v;
            else if (k == "token") o.Token = v;
            else if (k == "metrics") int.TryParse(v, out o.Metrics);
            else if (k == "lan") int.TryParse(v, out o.Lan);
        }
        return o;
    }
}

static class Program
{
    static void Main(string[] args)
    {
        if (Environment.UserInteractive)
        {
            var o = Options.From(args);
            if (string.IsNullOrEmpty(o.Token))
            {
                Console.WriteLine("укажите -token ТОКЕН (создаётся в консоли: Агенты → Создать токен агента)");
                Console.WriteLine("пример: pluto-agent.exe -server ws://192.168.31.219:8443/ws -token ТОКЕН");
                return;
            }
            Console.WriteLine("[pluto-agent] версия 1.7.0-cs · запуск в консольном режиме (Ctrl+C — выход)");
            new Worker(o.Server, o.Token, o.Metrics, o.Lan).Run();
        }
        else
        {
            ServiceBase.Run(new PlutoService());
        }
    }
}
