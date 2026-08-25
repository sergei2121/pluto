// PLUTO Agent — телеметрия Windows-машины для серверного ядра.
// Один бинарник, без внешних зависимостей. Ставится службой через -install.
package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// ─── Минимальный WebSocket-клиент (RFC 6455) ────────────────────────────────

type wsConn struct {
	c net.Conn
	r *bufio.Reader
}

func wsDial(raw string) (*wsConn, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	if u.Scheme == "wss" {
		return nil, fmt.Errorf("wss требует TLS-прокси; используйте ws:// или поставьте Caddy")
	}
	c, err := net.DialTimeout("tcp", host, 8*time.Second)
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)
	req := "GET " + u.RequestURI() + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		c.Close()
		return nil, err
	}
	r := bufio.NewReader(c)
	resp, err := http.ReadResponse(r, nil)
	if err != nil {
		c.Close()
		return nil, err
	}
	if resp.StatusCode != 101 {
		c.Close()
		return nil, fmt.Errorf("рукопожатие отклонено: %d", resp.StatusCode)
	}
	h := sha1.Sum([]byte(key + wsGUID))
	want := base64.StdEncoding.EncodeToString(h[:])
	if resp.Header.Get("Sec-WebSocket-Accept") != want {
		c.Close()
		return nil, fmt.Errorf("неверный Sec-WebSocket-Accept")
	}
	return &wsConn{c: c, r: r}, nil
}

func (w *wsConn) SendText(s string) error {
	payload := []byte(s)
	mask := make([]byte, 4)
	rand.Read(mask)
	var hdr []byte
	hdr = append(hdr, 0x81) // FIN + text
	n := len(payload)
	switch {
	case n < 126:
		hdr = append(hdr, byte(n)|0x80)
	case n < 65536:
		hdr = append(hdr, 126|0x80, 0, 0)
		binary.BigEndian.PutUint16(hdr[2:], uint16(n))
	default:
		hdr = append(hdr, 127|0x80, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(hdr[2:], uint64(n))
	}
	hdr = append(hdr, mask...)
	masked := make([]byte, n)
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	if _, err := w.c.Write(append(hdr, masked...)); err != nil {
		return err
	}
	return nil
}

func (w *wsConn) ReadMessage() (string, error) {
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(w.r, hdr); err != nil {
		return "", err
	}
	op := hdr[0] & 0x0f
	masked := hdr[1]&0x80 != 0
	n := int64(hdr[1] & 0x7f)
	switch n {
	case 126:
		b := make([]byte, 2)
		io.ReadFull(w.r, b)
		n = int64(binary.BigEndian.Uint16(b))
	case 127:
		b := make([]byte, 8)
		io.ReadFull(w.r, b)
		n = int64(binary.BigEndian.Uint64(b))
	}
	var mask []byte
	if masked {
		mask = make([]byte, 4)
		io.ReadFull(w.r, mask)
	}
	payload := make([]byte, n)
	if _, err := io.ReadFull(w.r, payload); err != nil {
		return "", err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	if op == 0x8 {
		return "", io.EOF
	}
	return string(payload), nil
}

func (w *wsConn) Close() { w.c.Close() }

// ─── Сборщики телеметрии ────────────────────────────────────────────────────

type Disk struct {
	Label string  `json:"label"`
	Total float64 `json:"total"`
	Used  float64 `json:"used"`
	Temp  float64 `json:"temp"`
}

type Metrics struct {
	CPULoad  float64 `json:"cpuLoad"`
	CPUCores int     `json:"cpuCores"`
	CPUTemp  float64 `json:"cpuTemp"`
	RamUsed  float64 `json:"ramUsed"`
	RamTotal float64 `json:"ramTotal"`
	RamTemp  float64 `json:"ramTemp"`
	Disks    []Disk  `json:"disks"`
	RxRate   float64 `json:"rxRate"`
	TxRate   float64 `json:"txRate"`
	RxBytes  float64 `json:"rxBytes"`
	TxBytes  float64 `json:"txBytes"`
}

func ps(script string) string {
	out, err := exec.Command("powershell", "-NoProfile", "-Command", script).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func toFloat(s string) float64 {
	s = strings.ReplaceAll(s, ",", ".")
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}

func collect(prev *Metrics) Metrics {
	m := Metrics{CPUCores: runtime.NumCPU()}

	m.CPULoad = toFloat(ps(`(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average`))

	os := ps(`$o = Get-CimInstance Win32_OperatingSystem; "$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)"`)
	if parts := strings.Fields(os); len(parts) == 2 {
		total := toFloat(parts[0]) * 1024
		free := toFloat(parts[1]) * 1024
		m.RamTotal = total
		m.RamUsed = total - free
	}

	m.CPUTemp = toFloat(ps(`$t = Get-CimInstance -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select -First 1; if($t){($t.CurrentTemperature-2732)/10}`))

	if out := ps(`Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | % { "$($_.DeviceID) $($_.Size) $($_.FreeSpace)" }`); out != "" {
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(strings.TrimSpace(line))
			if len(f) == 3 {
				total := toFloat(f[1])
				m.Disks = append(m.Disks, Disk{Label: f[0], Total: total, Used: total - toFloat(f[2])})
			}
		}
	}

	net := ps(`$n = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | % { "$($_.BytesReceivedPersec) $($_.BytesSentPersec) $($_.BytesReceivedTotal) $($_.BytesSentTotal)" }`)
	if net != "" {
		var rx, tx, rxt, txt float64
		for _, line := range strings.Split(net, "\n") {
			f := strings.Fields(strings.TrimSpace(line))
			if len(f) == 4 {
				rx += toFloat(f[0]); tx += toFloat(f[1]); rxt += toFloat(f[2]); txt += toFloat(f[3])
			}
		}
		m.RxRate = rx / 1024
		m.TxRate = tx / 1024
		m.RxBytes = rxt
		m.TxBytes = txt
	}
	return m
}

// ─── ARP-скан локальных сетей ───────────────────────────────────────────────

type Host struct {
	IP     string `json:"ip"`
	Mac    string `json:"mac"`
	Online bool   `json:"online"`
}
type Network struct {
	CIDR  string `json:"cidr"`
	Iface string `json:"iface"`
	Hosts []Host `json:"hosts"`
}

func scanLAN() []Network {
	var nets []Network
	ips := ps(`Get-NetIPAddress -AddressFamily IPv4 | ? { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } | % { "$($_.IPAddress)/$($_.PrefixLength) $($_.InterfaceAlias)" }`)
	if ips == "" {
		return nets
	}
	exec.Command("arp", "-a").Run()
	time.Sleep(300 * time.Millisecond)
	out, _ := exec.Command("arp", "-a").Output()
	var hosts []Host
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(strings.TrimSpace(line))
		if len(f) >= 2 && strings.Contains(f[0], ".") && strings.Contains(f[1], "-") {
			hosts = append(hosts, Host{IP: f[0], Mac: f[1], Online: true})
		}
	}
	for _, line := range strings.Split(ips, "\n") {
		f := strings.Fields(strings.TrimSpace(line))
		if len(f) == 2 {
			nets = append(nets, Network{CIDR: f[0], Iface: f[1], Hosts: hosts})
		}
	}
	return nets
}

// ─── Установка службой Windows ──────────────────────────────────────────────

const agentVersion = "1.7.5"

func installService(server, token string) {
	fmt.Println("[pluto-agent] версия", agentVersion)
	if token == "" {
		fmt.Println("укажите -token <ТОКЕН> (создаётся в консоли: Агенты → Создать токен агента)")
		os.Exit(1)
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("не удалось определить путь к pluto-agent.exe:", err)
		os.Exit(1)
	}
	exe, _ = filepath.Abs(exe)

	// sc.exe принимает пары "ключ= значение" ОТДЕЛЬНЫМИ аргументами
	// (знак равенства слитно с ключом, значение — следующим элементом).
	binPath := fmt.Sprintf(`"%s" -server %s -token %s`, exe, server, token)
	cmd := exec.Command("sc.exe", "create", "pluto-agent", "binPath=", binPath, "start=", "auto", "DisplayName=", "PLUTO Agent")
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Println("ошибка установки:", string(out))
		if strings.Contains(string(out), "1073") {
			fmt.Println("служба уже существует: выполните .\\pluto-agent.exe -uninstall и установите заново")
		}
		os.Exit(1)
	}
	fmt.Println("служба pluto-agent создана")
	fmt.Println("  binPath =", binPath)

	if out, err := exec.Command("sc.exe", "start", "pluto-agent").CombinedOutput(); err != nil {
		fmt.Println("служба создана, но не запустилась:", string(out))
		fmt.Println("запустите вручную: sc.exe start pluto-agent")
		return
	}
	fmt.Println("служба запущена — агент появится в консоли PLUTO в течение нескольких секунд")
}

func uninstallService() {
	exec.Command("sc.exe", "stop", "pluto-agent").Run()
	exec.Command("sc.exe", "delete", "pluto-agent").Run()
	fmt.Println("служба pluto-agent удалена")
}

// ─── Главный цикл ───────────────────────────────────────────────────────────

func run(server, token string, metricsSec, lanSec int) {
	hostname, _ := os.Hostname()
	var prev *Metrics
	var lastLAN time.Time

	for {
		conn, err := wsDial(server + "?token=" + url.QueryEscape(token))
		if err != nil {
			fmt.Println("[pluto-agent] подключение:", err, "— повтор через 5 с")
			time.Sleep(5 * time.Second)
			continue
		}
		hello, _ := json.Marshal(map[string]interface{}{
			"type": "hello", "hostname": hostname, "os": "Windows " + runtime.GOARCH, "version": agentVersion,
		})
		conn.SendText(string(hello))
		fmt.Println("[pluto-agent] подключено к", server)

		metTick := time.NewTicker(time.Duration(metricsSec) * time.Second)
		lanTick := time.NewTicker(time.Duration(lanSec) * time.Second)
		func() {
			defer metTick.Stop()
			defer lanTick.Stop()
			for {
				select {
				case <-metTick.C:
					m := collect(prev)
					prev = &m
					msg, _ := json.Marshal(map[string]interface{}{"type": "metrics", "data": m})
					if conn.SendText(string(msg)) != nil {
						return
					}
				case <-lanTick.C:
					if time.Since(lastLAN) > time.Duration(lanSec-1)*time.Second {
						lastLAN = time.Now()
						msg, _ := json.Marshal(map[string]interface{}{"type": "lan", "networks": scanLAN()})
						if conn.SendText(string(msg)) != nil {
							return
						}
					}
				}
			}
		}()
		conn.Close()
		fmt.Println("[pluto-agent] соединение потеряно — переподключение через 5 с")
		time.Sleep(5 * time.Second)
	}
}

func main() {
	server := flag.String("server", "ws://127.0.0.1:8443/ws", "адрес шлюза ядра")
	token := flag.String("token", "", "токен из консоли (Агенты → Создать токен)")
	metrics := flag.Int("metrics", 3, "интервал телеметрии, сек")
	lan := flag.Int("lan", 300, "интервал скана локальных сетей, сек")
	install := flag.Bool("install", false, "установить службой Windows")
	uninstall := flag.Bool("uninstall", false, "удалить службу")
	flag.Parse()

	// версию видно в любом режиме — по ней проверяют, что бинарник свежий
	if !*install && !*uninstall {
		fmt.Println("[pluto-agent] версия", agentVersion)
	}

	switch {
	case *install:
		installService(*server, *token)
	case *uninstall:
		uninstallService()
	default:
		if *token == "" {
			fmt.Println("укажите -token (создаётся в консоли: Агенты → Создать токен агента)")
			os.Exit(1)
		}
		run(*server, *token, *metrics, *lan)
	}
}
