// ─── PLUTO Agent для Windows (C#, .NET Framework 4.5+, синтаксис C# 5) ──────
// Компилируется ПРЯМО НА МАШИНЕ встроенным компилятором csc.exe, поэтому всегда
// получается под правильную архитектуру — ошибки «не является приложением» нет.
//
// Служба запускает exe БЕЗ аргументов: сервер и токен читаются из
// C:\ProgramData\pluto\agent.conf. Аргументы командной строки тоже работают и
// имеют приоритет (для ручного запуска).
//
// УСТОЙЧИВОСТЬ (версия 1.8.0):
//  - глобальные обработчики ловят ЛЮБОЕ необработанное исключение и пишут его в
//    лог ДО завершения процесса — «молчаливых» падений больше не бывает;
//  - приём сообщений — наблюдаемая Task с перехватом, не async void;
//  - сбор метрик и LAN-скан изолированы: одна неудачная WMI-выборка не роняет цикл;
//  - цикл подключения бесконечный: любая ошибка логируется и следует переподключение.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Net.WebSockets;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

// ─── Единый журнал (общий для службы и консольного режима) ───────────────────
static class AgentLog
{
    static readonly object Lock = new object();
    public static void Write(string s)
    {
        try { Console.WriteLine("[pluto-agent] " + s); } catch { }
        try
        {
            lock (Lock)
            {
                string dir = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData) + "\\pluto";
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.AppendAllText(dir + "\\agent.log",
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + s + "\r\n");
            }
        }
        catch { }
    }
}

static class Json
{
    public static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 32) sb.Append(' ');
            else sb.Append(c);
        }
        return sb.ToString();
    }
}

// ─── Сборщик телеметрии ─────────────────────────────────────────────────────
static class Collector
{
    static PerformanceCounter _cpu;
    static readonly object CpuLock = new object();

    static double CpuLoad()
    {
        try
        {
            lock (CpuLock)
            {
                if (_cpu == null) _cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total");
                _cpu.NextValue();
                Thread.Sleep(250);
                return Math.Round(_cpu.NextValue(), 1);
            }
        }
        catch { return 0; }
    }

    static double WmiTemp()
    {
        try
        {
            using (var s = new ManagementObjectSearcher(
                "root\\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature"))
            {
                foreach (ManagementObject o in s.Get())
                {
                    double t = (Convert.ToDouble(o["CurrentTemperature"]) - 2732) / 10.0;
                    if (t > 0 && t < 130) return Math.Round(t, 1);
                }
            }
        }
        catch { }
        return 0;
    }

    public static string MetricsJson()
    {
        double cpu = CpuLoad();
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

        var sb = new StringBuilder();
        sb.Append("{\"cpuLoad\":").Append(cpu);
        sb.Append(",\"cpuCores\":").Append(Environment.ProcessorCount);
        sb.Append(",\"cpuTemp\":").Append(WmiTemp());
        sb.Append(",\"ramTotal\":").Append(ramTotal.ToString("0"));
        sb.Append(",\"ramUsed\":").Append(ramUsed.ToString("0"));
        sb.Append(",\"ramTemp\":0");
        sb.Append(",\"disks\":").Append(DisksJson());
        sb.Append(",\"rxRate\":").Append(NetRate(true));
        sb.Append(",\"txRate\":").Append(NetRate(false));
        sb.Append("}");
        return sb.ToString();
    }

    static string DisksJson()
    {
        var list = new List<string>();
        try
        {
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                if (!d.IsReady || d.DriveType != DriveType.Fixed) continue;
                list.Add("{\"label\":\"" + Json.Esc(d.Name.TrimEnd('\\')) +
                         "\",\"total\":" + d.TotalSize.ToString("0") +
                         ",\"used\":" + (d.TotalSize - d.TotalFreeSpace).ToString("0") +
                         ",\"temp\":0}");
            }
        }
        catch { }
        return "[" + string.Join(",", list.ToArray()) + "]";
    }

    static long _lastRx, _lastTx; static DateTime _lastT = DateTime.MinValue;
    static double NetRate(bool rx)
    {
        try
        {
            long r = 0, t = 0;
            foreach (NetworkInterface n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up) continue;
                var st = n.GetIPv4Statistics();
                r += st.BytesReceived; t += st.BytesSent;
            }
            double kb = 0;
            if (_lastT != DateTime.MinValue)
            {
                double dt = (DateTime.Now - _lastT).TotalSeconds;
                if (dt > 0) kb = (rx ? (r - _lastRx) : (t - _lastTx)) / dt / 1024.0;
            }
            _lastRx = r; _lastTx = t; _lastT = DateTime.Now;
            return Math.Round(kb, 1);
        }
        catch { return 0; }
    }

    public static string LanJson()
    {
        var nets = new List<string>();
        try
        {
            var hosts = new List<string>();
            foreach (NetworkInterface n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up) continue;
                foreach (UnicastIPAddressInformation ip in n.GetIPProperties().UnicastAddresses)
                {
                    if (ip.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                    string addr = ip.Address.ToString();
                    if (addr.StartsWith("127.") || addr.StartsWith("169.254.")) continue;
                    var hs = new List<string>();
                    foreach (string h in ArpHosts()) hs.Add("{\"ip\":\"" + h + "\",\"online\":true}");
                    nets.Add("{\"cidr\":\"" + addr + "/" + ip.PrefixLength +
                             "\",\"iface\":\"" + Json.Esc(n.Name) +
                             "\",\"hosts\":[" + string.Join(",", hs.ToArray()) + "]}");
                }
            }
        }
        catch { }
        return "[" + string.Join(",", nets.ToArray()) + "]";
    }

    static List<string> ArpHosts()
    {
        var res = new List<string>();
        try
        {
            var psi = new ProcessStartInfo("arp", "-a");
            psi.UseShellExecute = false; psi.RedirectStandardOutput = true; psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi))
            {
                string line;
                while ((line = p.StandardOutput.ReadLine()) != null)
                {
                    string[] f = line.Trim().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (f.Length >= 2 && f[0].IndexOf('.') >= 0 && f[1].IndexOf('-') >= 0 && !f[0].StartsWith("169.254"))
                        if (!res.Contains(f[0])) res.Add(f[0]);
                }
                p.WaitForExit(3000);
            }
        }
        catch { }
        return res;
    }
}

// ─── Телеметрия AIDA64 (сенсорная веб-страница) ─────────────────────────────
// Читает HTML, который AIDA64 отдаёт по HTTP (RemoteSensor, по умолчанию порт
// 8090), и извлекает значения пунктов: CPUu, CPU, RAM, SSD, UseC, TX, RX, Uptime.
class Aida
{
    public double? CpuUsage; // CPUu — загрузка ЦП, %
    public double? CpuTemp;  // CPU  — температура ЦП, °C
    public double? Ram;      // RAM  — занято ОЗУ, %
    public double? SsdTemp;  // SSD  — температура SSD, °C
    public double? DiskC;    // UseC — занято диска C, %
    public double? Tx;       // TX   — скорость загрузки адаптера, КБ/с
    public double? Rx;       // RX   — скорость отдачи адаптера, КБ/с
    public double? Uptime;   // Uptime — время онлайн, сек

    public bool HasAny
    {
        get
        {
            return CpuUsage.HasValue || CpuTemp.HasValue || Ram.HasValue || SsdTemp.HasValue
                || DiskC.HasValue || Tx.HasValue || Rx.HasValue || Uptime.HasValue;
        }
    }

    public string ToJson()
    {
        return "{\"cpuUsage\":" + N(CpuUsage) + ",\"cpuTemp\":" + N(CpuTemp) +
               ",\"ram\":" + N(Ram) + ",\"ssdTemp\":" + N(SsdTemp) +
               ",\"diskC\":" + N(DiskC) + ",\"tx\":" + N(Tx) + ",\"rx\":" + N(Rx) +
               ",\"uptimeSec\":" + N(Uptime) + "}";
    }

    static string N(double? d)
    {
        return d.HasValue ? d.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) : "null";
    }
}

static class AidaReader
{
    /// <summary>Скачивает страницу AIDA64 и разбирает значения. null = данных нет.</summary>
    public static Aida Read(string url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 6000;
            req.ReadWriteTimeout = 6000;
            string html;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                html = sr.ReadToEnd();

            // убираем теги и HTML-сущности — остаётся плоский текст «имя значение»
            string text = Regex.Replace(html, "<[^>]+>", " ");
            text = Regex.Replace(text, "&nbsp;|&#160;|&deg;C?;", " ");

            var a = new Aida();
            a.CpuUsage = NumAfter(text, "CPUu");
            a.CpuTemp = NumAfter(text, "CPU");
            a.Ram = NumAfter(text, "RAM");
            a.SsdTemp = NumAfter(text, "SSD");
            a.DiskC = NumAfter(text, "UseC");
            a.Tx = RateAfter(text, "TX");
            a.Rx = RateAfter(text, "RX");
            a.Uptime = UptimeAfter(text, "Uptime");
            return a;
        }
        catch { return null; } // AIDA64 не отдаёт страницу — не ошибка, просто нет данных
    }

    static string Tail(string text, string label, int len)
    {
        var m = Regex.Match(text, @"\b" + label + @"\b", RegexOptions.IgnoreCase);
        if (!m.Success) return null;
        int start = m.Index + m.Length;
        return text.Substring(start, Math.Min(len, text.Length - start));
    }

    static double? ParseNum(string s)
    {
        double v;
        if (!double.TryParse(s.Replace(" ", "").Replace(',', '.'),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out v))
            return null;
        return v;
    }

    static double? NumAfter(string text, string label)
    {
        string tail = Tail(text, label, 40);
        if (tail == null) return null;
        var mv = Regex.Match(tail, @"(-?\d[\d\s]{0,10}(?:[.,]\d+)?)");
        return mv.Success ? ParseNum(mv.Groups[1].Value) : (double?)null;
    }

    /// <summary>Скорость сети: нормализуем МБ/с и ГБ/с к КБ/с.</summary>
    static double? RateAfter(string text, string label)
    {
        string tail = Tail(text, label, 40);
        if (tail == null) return null;
        var mv = Regex.Match(tail, @"(-?\d[\d\s]{0,10}(?:[.,]\d+)?)");
        if (!mv.Success) return null;
        var v = ParseNum(mv.Groups[1].Value);
        if (!v.HasValue) return null;
        string unitTail = tail.Substring(mv.Index + mv.Length);
        if (Regex.IsMatch(unitTail, @"^\s*(?:МБ|MB)", RegexOptions.IgnoreCase)) v = v.Value * 1024;
        else if (Regex.IsMatch(unitTail, @"^\s*(?:ГБ|GB)", RegexOptions.IgnoreCase)) v = v.Value * 1048576;
        return Math.Round(v.Value, 1);
    }

    /// <summary>Uptime: «2 д. 3:42:11» или «3:42:11» → секунды.</summary>
    static double? UptimeAfter(string text, string label)
    {
        string tail = Tail(text, label, 50);
        if (tail == null) return null;
        var mt = Regex.Match(tail, @"(?:(\d+)\s*(?:д|d)\.?\s*)?(\d{1,3}):(\d{1,2}):(\d{1,2})", RegexOptions.IgnoreCase);
        if (!mt.Success) return null;
        double d = mt.Groups[1].Success ? double.Parse(mt.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : 0;
        double h = double.Parse(mt.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
        double mi = double.Parse(mt.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture);
        double s = double.Parse(mt.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture);
        return d * 86400 + h * 3600 + mi * 60 + s;
    }
}

// ─── Конфигурация (agent.conf + аргументы) ──────────────────────────────────
class Options
{
    public string Server = "ws://127.0.0.1:8443/ws";
    public string Token = "";
    public int Metrics = 5;
    public int Lan = 300;
    public string Aida64 = "http://127.0.0.1:8090/"; // сенсорная веб-страница AIDA64

    public static Options Load(string[] args)
    {
        var o = new Options();
        try
        {
            string p = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData) + "\\pluto\\agent.conf";
            if (File.Exists(p))
            {
                foreach (string raw in File.ReadAllLines(p))
                {
                    string l = raw.Trim();
                    int eq = l.IndexOf('=');
                    if (eq <= 0 || l.StartsWith("#")) continue;
                    string k = l.Substring(0, eq).Trim();
                    string v = l.Substring(eq + 1).Trim();
                    if (k == "server") o.Server = v;
                    else if (k == "token") o.Token = v;
                    else if (k == "metrics") { int x; if (int.TryParse(v, out x) && x > 0) o.Metrics = x; }
                    else if (k == "lan") { int x; if (int.TryParse(v, out x) && x > 0) o.Lan = x; }
                    else if (k == "aida64") o.Aida64 = v;
                }
                AgentLog.Write("конфигурация загружена: " + p);
            }
        }
        catch (Exception e) { AgentLog.Write("ошибка чтения конфига: " + e.Message); }

        // аргументы командной строки имеют приоритет над конфигом
        for (int i = 0; i < args.Length - 1; i++)
        {
            string k = args[i].TrimStart('-');
            string v = args[i + 1];
            if (k == "server") o.Server = v;
            else if (k == "token") o.Token = v;
            else if (k == "metrics") { int x; if (int.TryParse(v, out x) && x > 0) o.Metrics = x; }
            else if (k == "lan") { int x; if (int.TryParse(v, out x) && x > 0) o.Lan = x; }
            else if (k == "aida64") o.Aida64 = v;
        }
        return o;
    }

    /// <summary>Обновляет строку aida64= в agent.conf (URL может прилететь из ядра).</summary>
    public static void PersistAida64(string url)
    {
        try
        {
            string p = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData) + "\\pluto\\agent.conf";
            var lines = File.Exists(p)
                ? new List<string>(File.ReadAllLines(p))
                : new List<string>();
            bool found = false;
            for (int i = 0; i < lines.Count; i++)
            {
                if (lines[i].TrimStart().StartsWith("aida64=")) { lines[i] = "aida64=" + url; found = true; }
            }
            if (!found) lines.Add("aida64=" + url);
            File.WriteAllLines(p, lines);
        }
        catch { }
    }
}

// ─── Рабочий цикл подключения ───────────────────────────────────────────────
class Worker
{
    readonly Options _o;
    readonly ManualResetEvent _stop = new ManualResetEvent(false);

    public Worker(Options o) { _o = o; }
    public void Stop() { _stop.Set(); }

    public void Run()
    {
        while (!_stop.WaitOne(0))
        {
            try { RunOnce().GetAwaiter().GetResult(); }
            catch (Exception e) { AgentLog.Write("цикл упал: " + e.GetBaseException().GetType().Name + ": " + e.GetBaseException().Message); }
            if (!_stop.WaitOne(0)) { AgentLog.Write("переподключение через 5 с…"); _stop.WaitOne(5000); }
        }
    }

    async Task RunOnce()
    {
        using (var ws = new ClientWebSocket())
        {
            string url = _o.Server + (_o.Server.Contains("?") ? "&" : "?") + "token=" + Uri.EscapeDataString(_o.Token);
            AgentLog.Write("подключаюсь к " + _o.Server + " (токен скрыт)");
            var cts = new CancellationTokenSource(15000);
            await ws.ConnectAsync(new Uri(url), cts.Token);
            AgentLog.Write("подключено к " + _o.Server);

            string hello = "{\"type\":\"hello\",\"hostname\":\"" + Json.Esc(Environment.MachineName) +
                           "\",\"os\":\"Windows\",\"version\":\"1.8.4-cs\"}";
            await Send(ws, hello);

            // Приём сообщений — наблюдаемая Task. Любая ошибка внутри НЕ убивает
            // процесс (была async void → молчаливое падение), а только логируется.
            Task recv = ReceiveLoop(ws);

            int lanCounter = 0; // LAN-скан сразу при старте
            int sinceLog = 0;
            bool firstLogged = false;
            while (ws.State == WebSocketState.Open && !_stop.WaitOne(0))
            {
                // сбор метрик — на отдельном потоке с жёстким таймаутом:
                // зависший WMI-запрос не заморозит агента и не оборвёт связь
                string mj = CollectWithTimeout(10000);
                if (mj != null)
                {
                    // данные с сенсорной веб-страницы AIDA64 (если отдаёт страницу)
                    string aida = null;
                    try
                    {
                        var av = AidaReader.Read(_o.Aida64);
                        if (av != null && av.HasAny) aida = av.ToJson();
                    }
                    catch { }
                    await Send(ws, "{\"type\":\"metrics\",\"data\":" + mj + (aida != null ? ",\"aida\":" + aida : "") + "}");
                    if (!firstLogged) { firstLogged = true; AgentLog.Write("первая метрика отправлена" + (aida != null ? " (+ AIDA64)" : "")); }
                }

                lanCounter += _o.Metrics;
                if (lanCounter >= _o.Lan)
                {
                    lanCounter = 0;
                    string lj;
                    try { lj = Collector.LanJson(); }
                    catch (Exception e) { AgentLog.Write("LAN-скан: " + e.Message); lj = "[]"; }
                    await Send(ws, "{\"type\":\"lan\",\"networks\":" + lj + "}");
                }

                // периодический «пульс» в лог, чтобы было видно, что агент жив
                sinceLog += _o.Metrics;
                if (sinceLog >= 60) { sinceLog = 0; AgentLog.Write("жив, отправляю метрики каждые " + _o.Metrics + " с"); }

                if (_stop.WaitOne(_o.Metrics * 1000)) break;
            }

            AgentLog.Write("цикл завершён (состояние сокета: " + ws.State + ")");
            try { await recv; } catch { } // наблюдаем задачу приёма
        }
    }

    /// <summary>Сбор метрик с таймаутом: если WMI завис, такт пропускается, а агент живёт.</summary>
    static string CollectWithTimeout(int timeoutMs)
    {
        string result = null;
        var th = new Thread(() =>
        {
            try { result = Collector.MetricsJson(); }
            catch (Exception e) { AgentLog.Write("сбор метрик: " + e.GetBaseException().Message); result = "{}"; }
        });
        th.IsBackground = true;
        th.Start();
        if (!th.Join(timeoutMs))
        {
            AgentLog.Write("сбор метрик дольше " + timeoutMs + " мс — такт пропущен (проверьте службу Winmgmt)");
            return null;
        }
        return result;
    }

    async Task ReceiveLoop(ClientWebSocket ws)
    {
        var buf = new byte[16384];
        var sb = new StringBuilder();
        try
        {
            while (ws.State == WebSocketState.Open && !_stop.WaitOne(0))
            {
                var seg = new ArraySegment<byte>(buf);
                WebSocketReceiveResult res;
                try { res = await ws.ReceiveAsync(seg, CancellationToken.None); }
                catch (Exception e) { AgentLog.Write("приём (сокет): " + e.GetBaseException().Message); return; }

                if (res.MessageType == WebSocketMessageType.Close)
                {
                    AgentLog.Write("сервер закрыл соединение");
                    try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
                    return;
                }
                sb.Append(Encoding.UTF8.GetString(buf, 0, res.Count));
                if (res.EndOfMessage)
                {
                    string msg = sb.ToString(); sb.Length = 0;
                    HandleServerMessage(msg);
                }
            }
        }
        catch (Exception e) { AgentLog.Write("приём: " + e.GetBaseException().Message); }
    }

    void HandleServerMessage(string msg)
    {
        try
        {
            if (msg.Contains("\"config\""))
            {
                int m = ExtractInt(msg, "metrics");
                int l = ExtractInt(msg, "lanScan");
                if (m > 0) _o.Metrics = m;
                if (l > 0) _o.Lan = l;
                string aid = ExtractString(msg, "aida64");
                if (!string.IsNullOrEmpty(aid) && aid != _o.Aida64)
                {
                    _o.Aida64 = aid;
                    Options.PersistAida64(aid);
                    AgentLog.Write("AIDA64 URL обновлён из ядра: " + aid);
                }
                AgentLog.Write("конфиг от ядра: метрики " + _o.Metrics + " с, LAN " + _o.Lan + " с, AIDA64: " + _o.Aida64);
            }
            else if (msg.Contains("\"error\""))
            {
                AgentLog.Write("ОШИБКА от сервера: " + msg);
            }
            else
            {
                AgentLog.Write("от сервера: " + (msg.Length > 120 ? msg.Substring(0, 120) + "…" : msg));
            }
        }
        catch (Exception e) { AgentLog.Write("разбор сообщения: " + e.Message); }
    }

    static string ExtractString(string json, string key)
    {
        int i = json.IndexOf("\"" + key + "\"");
        if (i < 0) return null;
        i = json.IndexOf(':', i);
        if (i < 0) return null;
        int q1 = json.IndexOf('"', i + 1);
        if (q1 < 0) return null;
        int q2 = json.IndexOf('"', q1 + 1);
        if (q2 < 0) return null;
        return json.Substring(q1 + 1, q2 - q1 - 1);
    }

    static int ExtractInt(string json, string key)
    {
        int i = json.IndexOf("\"" + key + "\"");
        if (i < 0) return 0;
        i = json.IndexOf(':', i);
        if (i < 0) return 0;
        var sb = new StringBuilder();
        for (int j = i + 1; j < json.Length; j++)
        {
            char c = json[j];
            if (char.IsDigit(c)) sb.Append(c);
            else if (sb.Length > 0) break;
        }
        int v; return int.TryParse(sb.ToString(), out v) ? v : 0;
    }

    async Task Send(ClientWebSocket ws, string text)
    {
        var buf = new ArraySegment<byte>(Encoding.UTF8.GetBytes(text));
        using (var cts = new CancellationTokenSource(10000))
            await ws.SendAsync(buf, WebSocketMessageType.Text, true, cts.Token);
    }
}

// ─── Служба Windows ─────────────────────────────────────────────────────────
class PlutoService : ServiceBase
{
    Worker _w;
    public PlutoService() { ServiceName = "pluto-agent"; CanStop = true; }

    protected override void OnStart(string[] args)
    {
        AgentLog.Write("служба запускается (PID " + Process.GetCurrentProcess().Id + ", версия 1.8.1-cs)");
        var o = Options.Load(RealCommandLine.Args());
        AgentLog.Write("режим: сервер " + o.Server + ", токен " + (string.IsNullOrEmpty(o.Token) ? "ОТСУТСТВУЕТ" : "загружен"));
        if (string.IsNullOrEmpty(o.Token))
        {
            AgentLog.Write("ОШИБКА: токен не найден в agent.conf. Переустановите агент (install.ps1 -Token …).");
            return;
        }
        _w = new Worker(o);
        var t = new Thread(new ThreadStart(_w.Run));
        t.IsBackground = true;
        t.Start();
    }
    protected override void OnStop() { if (_w != null) _w.Stop(); }
}

// Настоящая командная строка процесса (Win32) — аргументы приходят и в режиме
// ручной установки службы с binPath вида "exe -server … -token …".
static class RealCommandLine
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetCommandLineW();
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CommandLineToArgvW(IntPtr lpCmdLine, out int pNumArgs);

    public static string[] Args()
    {
        try
        {
            IntPtr cmd = GetCommandLineW();
            int argc;
            IntPtr argv = CommandLineToArgvW(cmd, out argc);
            if (argv == IntPtr.Zero) return Environment.GetCommandLineArgs();
            var args = new string[argc];
            for (int i = 0; i < argc; i++)
                args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size));
            return args;
        }
        catch { return Environment.GetCommandLineArgs(); }
    }
}

// ─── Точка входа ────────────────────────────────────────────────────────────
static class Program
{
    // Глобальные ловушки: ЛЮБОЕ необработанное исключение попадает в лог,
    // поэтому «молчаливых» падений больше не бывает.
    static void InstallCrashHooks()
    {
        AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
        {
            AgentLog.Write("НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ (процесс завершится): " + e.ExceptionObject);
        };
        TaskScheduler.UnobservedTaskException += delegate(object s, UnobservedTaskExceptionEventArgs e)
        {
            AgentLog.Write("НЕОБСЛУЖЕННАЯ TASK: " + e.Exception);
            e.SetObserved();
        };
    }

    static void Main(string[] args)
    {
        InstallCrashHooks();
        if (Environment.UserInteractive)
        {
            var o = Options.Load(args);
            if (string.IsNullOrEmpty(o.Token))
            {
                Console.WriteLine("укажите токен: pluto-agent.exe -token ТОКЕН  (или создайте C:\\ProgramData\\pluto\\agent.conf)");
                return;
            }
            Console.WriteLine("[pluto-agent] версия 1.8.1-cs · консольный режим (Ctrl+C — выход)");
            new Worker(o).Run();
        }
        else
        {
            ServiceBase.Run(new PlutoService());
        }
    }
}
