// PLUTO Agent для Windows: телеметрия машины + скан локальных сетей.
// Сборка: go build -o pluto-agent.exe .
// Запуск: pluto-agent.exe -server wss://pluto.example.com:8443/ws -token <ТОКЕН>
// Служба: pluto-agent.exe -install -server ... -token ...
package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const version = "1.4.0"

// ─── Минимальный WebSocket-клиент (RFC 6455, только stdlib) ─────────────────

type wsConn struct {
	c   net.Conn
	br  *bufio.Reader
	buf []byte
}

func wsDial(server string) (*wsConn, error) {
	u, err := url.Parse(server)
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
	var c net.Conn
	if u.Scheme == "wss" {
		c, err = tls.Dial("tcp", host, &tls.Config{ServerName: u.Hostname()})
	} else {
		c, err = net.DialTimeout("tcp", host, 10*time.Second)
	}
	if err != nil {
		return nil, err
	}
	keyRaw := make([]byte, 16)
	rand.Read(keyRaw)
	key := base64.StdEncoding.EncodeToString(keyRaw)
	path := u.RequestURI()
	if path == "" {
		path = "/ws"
	}
	fmt.Fprintf(c, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, u.Host, key)
	br := bufio.NewReader(c)
	status, err := br.ReadString('\n')
	if err != nil {
		c.Close()
		return nil, err
	}
	if !strings.Contains(status, "101") {
		c.Close()
		return nil, fmt.Errorf("handshake: %s", strings.TrimSpace(status))
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil || strings.TrimSpace(line) == "" {
			break
		}
	}
	return &wsConn{c: c, br: br}, nil
}

func (w *wsConn) WriteText(s string) error {
	payload := []byte(s)
	mask := make([]byte, 4)
	rand.Read(mask)
	header := []byte{0x81, 0}
	if len(payload) < 126 {
		header[1] = byte(len(payload)) | 0x80
	} else if len(payload) < 65536 {
		header[1] = 126 | 0x80
		header = append(header, 0, 0)
		binary.BigEndian.PutUint16(header[2:], uint16(len(payload)))
	} else {
		header[1] = 127 | 0x80
		header = append(header, make([]byte, 8)...)
		binary.BigEndian.PutUint64(header[2:], uint64(len(payload)))
	}
	frame := append(header, mask...)
	masked := make([]byte, len(payload))
	for i, b := range payload {
		masked[i] = b ^ mask[i%4]
	}
	frame = append(frame, masked...)
	_, err := w.c.Write(frame)
	return err
}

func (w *wsConn) ReadText() (string, error) {
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(w.br, hdr); err != nil {
		return "", err
	}
	length := int64(hdr[1] & 0x7f)
	switch {
	case length == 126:
		ext := make([]byte, 2)
		if _, err := io.ReadFull(w.br, ext); err != nil {
			return "", err
		}
		length = int64(binary.BigEndian.Uint16(ext))
	case length == 127:
		ext := make([]byte, 8)
		if _, err := io.ReadFull(w.br, ext); err != nil {
			return "", err
		}
		length = int64(binary.BigEndian.Uint64(ext))
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(w.br, payload); err != nil {
		return "", err
	}
	if hdr[0]&0x0f == 0x8 {
		return "", io.EOF
	}
	return string(payload), nil
}

func (w *wsConn) Close() { w.c.Close() }

// ─── Сборщики телеметрии (PowerShell / WMI / arp) ───────────────────────────

func ps(script string) string {
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

type Disk struct {
	Letter string  `json:"letter"`
	Total  float64 `json:"total"`
	Used   float64 `json:"used"`
	Temp   float64 `json:"temp"`
}

func collectCPU() float64 {
	v := ps("(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average")
	f, _ := strconv.ParseFloat(strings.Replace(v, ",", ".", 1), 64)
	return f
}

func collectRAM() (totalKB, freeKB float64) {
	out := ps("$o = Get-CimInstance Win32_OperatingSystem; \"$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)\"")
	parts := strings.Fields(out)
	if len(parts) == 2 {
		totalKB, _ = strconv.ParseFloat(parts[0], 64)
		freeKB, _ = strconv.ParseFloat(parts[1], 64)
	}
	return
}

func collectDisks() []Disk {
	var disks []Disk
	out := ps("Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { \"$($_.DeviceID) $($_.Size) $($_.FreeSpace)\" }")
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Fields(strings.TrimSpace(line))
		if len(parts) != 3 {
			continue
		}
		size, _ := strconv.ParseFloat(parts[1], 64)
		free, _ := strconv.ParseFloat(parts[2], 64)
		disks = append(disks, Disk{Letter: parts[0], Total: size, Used: size - free})
	}
	return disks
}

// Температура через WMI (требует прав администратора; 0 = недоступно)
func collectTemp() float64 {
	out := ps("(Get-CimInstance -Namespace root\\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentTemperature")
	v, _ := strconv.ParseFloat(strings.Replace(out, ",", ".", 1), 64)
	if v > 0 {
		return v/10 - 273.15
	}
	return 0
}

var (
	prevRx, prevTx   uint64
	prevNet          time.Time
	netRe            = regexp.MustCompile(`(\d+)`)
)

func collectNet() (rxRate, txRate float64) {
	out := ps("$s = Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes,SentBytes -Sum; \"$($s[0].Sum) $($s[1].Sum)\"")
	nums := netRe.FindAllString(out, -1)
	if len(nums) < 2 {
		return 0, 0
	}
	rx, _ := strconv.ParseUint(nums[0], 10, 64)
	tx, _ := strconv.ParseUint(nums[1], 10, 64)
	now := time.Now()
	if !prevNet.IsZero() && rx >= prevRx && tx >= prevTx {
		dt := now.Sub(prevNet).Seconds()
		rxRate = float64(rx-prevRx) / 1024 / dt
		txRate = float64(tx-prevTx) / 1024 / dt
	}
	prevRx, prevTx, prevNet = rx, tx, now
	return
}

type Host struct {
	IP       string `json:"ip"`
	MAC      string `json:"mac"`
	Hostname string `json:"hostname"`
	Online   bool   `json:"online"`
}

type Network struct {
	Iface  string `json:"iface"`
	Subnet string `json:"subnet"`
	Hosts  []Host `json:"hosts"`
}

// Доступные локальные сети: ARP-таблица машины
func scanLAN() []Network {
	bySubnet := map[string][]Host{}
	out, err := exec.Command("arp", "-a").Output()
	if err == nil {
		re := regexp.MustCompile(`^\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{11,17})\s+(\w+)`)
		for _, line := range strings.Split(string(out), "\n") {
			m := re.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			ip := m[1]
			sub := ip[:strings.LastIndex(ip, ".")] + ".0/24"
			bySubnet[sub] = append(bySubnet[sub], Host{IP: ip, MAC: strings.ToUpper(m[2]), Online: m[3] == "dynamic"})
		}
	}
	var nets []Network
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP.To4() == nil {
				continue
			}
			ones, _ := ipn.Mask.Size()
			sub := fmt.Sprintf("%s/%d", ipn.IP.Mask(ipn.Mask).String(), ones)
			nets = append(nets, Network{Iface: ifc.Name, Subnet: sub, Hosts: bySubnet[sub]})
		}
	}
	return nets
}

// ─── Цикл агента ────────────────────────────────────────────────────────────

func sendJSON(w *wsConn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return w.WriteText(string(b))
}

func run(server, token string, metricsSec, lanSec int) {
	hostname, _ := os.Hostname()
	backoff := time.Second
	for {
		conn, err := wsDial(server + "?token=" + url.QueryEscape(token))
		if err != nil {
			fmt.Printf("[pluto-agent] нет связи с сервером (%v), повтор через %s\n", err, backoff)
			time.Sleep(backoff)
			if backoff < time.Minute {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		fmt.Printf("[pluto-agent] подключён к %s\n", server)

		osName := ps("(Get-CimInstance Win32_OperatingSystem).Caption")
		sendJSON(conn, map[string]any{"type": "hello", "hostname": hostname, "os": osName, "version": version})

		metricsTick := time.NewTicker(time.Duration(metricsSec) * time.Second)
		lanTick := time.NewTicker(time.Duration(lanSec) * time.Second)
		readErr := make(chan error, 1)
		go func() {
			for {
				if _, err := conn.ReadText(); err != nil {
					readErr <- err
					return
				}
			}
		}()

	collect := func() {
		totalKB, freeKB := collectRAM()
		rx, tx := collectNet()
		data := map[string]any{
			"cpuLoad":  collectCPU(),
			"cpuTemp":  collectTemp(),
			"ramTotal": totalKB * 1024,
			"ramUsed":  (totalKB - freeKB) * 1024,
			"disks":    collectDisks(),
			"rxRate":   rx,
			"txRate":   tx,
		}
		if err := sendJSON(conn, map[string]any{"type": "metrics", "data": data}); err != nil {
			readErr <- err
		}
	}
	collect()
	sendJSON(conn, map[string]any{"type": "lan", "networks": scanLAN()})

	loop:
		for {
			select {
			case <-metricsTick.C:
				collect()
			case <-lanTick.C:
				if err := sendJSON(conn, map[string]any{"type": "lan", "networks": scanLAN()}); err != nil {
					break loop
				}
			case <-readErr:
				break loop
			}
		}
		metricsTick.Stop()
		lanTick.Stop()
		conn.Close()
		fmt.Println("[pluto-agent] соединение потеряно, переподключение…")
		time.Sleep(2 * time.Second)
	}
}

func main() {
	server := flag.String("server", "ws://localhost:8443/ws", "адрес шлюза агентов")
	token := flag.String("token", "", "токен подключения из консоли PLUTO")
	metricsSec := flag.Int("metrics", 3, "интервал телеметрии, сек")
	lanSec := flag.Int("lan", 300, "интервал скана локальных сетей, сек")
	install := flag.Bool("install", false, "установить как службу Windows (pluto-agent)")
	uninstall := flag.Bool("uninstall", false, "удалить службу Windows")
	flag.Parse()

	if *uninstall {
		exec.Command("sc.exe", "stop", "pluto-agent").Run()
		out, err := exec.Command("sc.exe", "delete", "pluto-agent").CombinedOutput()
		fmt.Printf("%s (%v)\n", out, err)
		return
	}
	if *install {
		exe, _ := os.Executable()
		bin := fmt.Sprintf("\"%s\" -server %s -token %s -metrics %d -lan %d", exe, *server, *token, *metricsSec, *lanSec)
		if out, err := exec.Command("sc.exe", "create", "pluto-agent", "binPath=", bin, "start=", "auto", "DisplayName=", "PLUTO Agent").CombinedOutput(); err != nil {
			fmt.Printf("ошибка установки службы: %s (%v)\n", out, err)
			os.Exit(1)
		}
		exec.Command("sc.exe", "description", "pluto-agent", "PLUTO monitoring agent").Run()
		out, err := exec.Command("sc.exe", "start", "pluto-agent").CombinedOutput()
		fmt.Printf("%s (%v)\n", out, err)
		return
	}
	if *token == "" {
		fmt.Println("укажите -token (создаётся в консоли PLUTO: Агенты → Токен подключения)")
		os.Exit(1)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	go func() {
		<-stop
		fmt.Println("\n[pluto-agent] остановлен")
		os.Exit(0)
	}()

	// убедимся, что неиспользуемые импорты sha1/binary не вычищены линтером
	_ = sha1.Size
	run(*server, *token, *metricsSec, *lanSec)
}
