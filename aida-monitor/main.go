// PLUTO aida-monitor — лёгкий прокси-мониторинг для Windows-машин.
//
// Сервер сам пингует агента, читает строку показаний с его веб-страницы AIDA64
// (RemoteSensor, формат: "CPUu 3%, CPU 42°C, RAM 25%, ..."), разбирает её и
// пингует устройства по заданным IP / диапазонам. Никаких токенов, агентов-служб
// и WMI — только ping + HTTP-чтение страницы AIDA64.
//
// Сборка и запуск:
//   go mod tidy && go build -o aida-monitor.exe .
//   .\aida-monitor.exe            (слушает :8080)
//
// Список агентов берётся из agents.json (если файл есть рядом), иначе — из
// встроенного примера ниже.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Модели ──────────────────────────────────────────────────────────────────

// Agent — одна наблюдаемая машина: её адрес (по нему же отдаётся страница
// AIDA64) и список устройств/диапазонов для пинга.
type Agent struct {
	ID      string   `json:"id"`
	Address string   `json:"address"` // http://<ip>:8090 — страница AIDA64 RemoteSensor
	Devices []string `json:"devices"` // "192.168.1.5" или "192.168.1.10-20"
}

// Metrics — сводка по агенту: доступность, задержка, показания AIDA64 и
// результаты пинга устройств.
type Metrics struct {
	CPUUsage    float64      `json:"cpu_usage"`     // CPUu, %
	CPUTemp     float64      `json:"cpu_temp"`      // CPU, °C
	RAMUsage    float64      `json:"ram_usage"`     // RAM, %
	SSDTemp     float64      `json:"ssd_temp"`      // SSD, °C
	UseC        float64      `json:"use_c"`         // UseC, %
	UsedSpaceC  float64      `json:"used_space_c"`  // UsedSpaceC, ГБ
	TX          float64      `json:"tx"`            // TX, КБ/с
	RX          float64      `json:"rx"`            // RX, КБ/с
	Uptime      string       `json:"uptime"`        // Uptime, "чч:мм:сс"
	IsOnline    bool         `json:"is_online"`     // отвечает ли машина на ping
	Latency     int64        `json:"latency_ms"`    // задержка ping до агента
	DevicePings []PingResult `json:"device_pings"`  // пинг устройств через агента
}

// PingResult — результат пинга одного устройства.
type PingResult struct {
	Address string `json:"address"`
	IsAlive bool   `json:"is_alive"`
	Latency int64  `json:"latency_ms"`
}

// ─── Список агентов ─────────────────────────────────────────────────────────

var agents = map[string]Agent{
	"agent1": {ID: "agent1", Address: "http://localhost:8090", Devices: []string{"192.168.1.1", "192.168.1.10-20"}},
}

// loadAgents подменяет встроенный пример списком из agents.json, если файл есть.
func loadAgents() {
	data, err := os.ReadFile("agents.json")
	if err != nil {
		return // файла нет — остаётся встроенный пример
	}
	var list []Agent
	if err := json.Unmarshal(data, &list); err != nil {
		fmt.Println("[aida-monitor] не удалось разобрать agents.json:", err)
		return
	}
	if len(list) == 0 {
		return
	}
	agents = make(map[string]Agent, len(list))
	for _, a := range list {
		agents[a.ID] = a
	}
	fmt.Printf("[aida-monitor] загружено агентов из agents.json: %d\n", len(list))
}

// ─── Разбор строки AIDA64 ───────────────────────────────────────────────────

// parseAidaLine разбирает строку вида:
//   "CPUu 3%, CPU 42°C, RAM 25%, SSD 50°C, UseC 43%, UsedSpaceC 101GB,
//    TX 0.8 KB/s, RX 0.4 KB/s, Uptime 01:39:45"
// Формат одинаков на всех машинах — значения идут сразу после имени, через
// запятую с пробелом.
func parseAidaLine(line string) *Metrics {
	parts := strings.Split(strings.TrimSpace(line), ", ")
	if len(parts) < 2 {
		return nil
	}

	m := &Metrics{}
	for _, part := range parts {
		kv := strings.SplitN(strings.TrimSpace(part), " ", 2)
		if len(kv) != 2 {
			continue
		}
		key := kv[0]
		value := kv[1]

		switch key {
		case "CPUu":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "%"), 64); err == nil {
				m.CPUUsage = v
			}
		case "CPU":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "°C"), 64); err == nil {
				m.CPUTemp = v
			}
		case "RAM":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "%"), 64); err == nil {
				m.RAMUsage = v
			}
		case "SSD":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "°C"), 64); err == nil {
				m.SSDTemp = v
			}
		case "UseC":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "%"), 64); err == nil {
				m.UseC = v
			}
		case "UsedSpaceC":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, "GB"), 64); err == nil {
				m.UsedSpaceC = v
			}
		case "TX":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, " KB/s"), 64); err == nil {
				m.TX = v
			}
		case "RX":
			if v, err := strconv.ParseFloat(strings.TrimSuffix(value, " KB/s"), 64); err == nil {
				m.RX = v
			}
		case "Uptime":
			m.Uptime = value
		}
	}
	return m
}

// ─── Пинг и диапазоны ───────────────────────────────────────────────────────

// pingAddress пингует адрес и возвращает (доступен, задержка_мс).
// Флаг количества пакетов зависит от ОС: -c (Linux/macOS) или -n (Windows).
func pingAddress(addr string) (bool, int64) {
	start := time.Now()
	flag := "-c"
	if runtime.GOOS == "windows" {
		flag = "-n"
	}
	cmd := exec.Command("ping", flag, "1", addr)
	err := cmd.Run()
	duration := time.Since(start).Milliseconds()
	return err == nil, duration
}

// expandIPRange разворачивает "192.168.1.10-20" в список отдельных IP.
// Одиночный IP возвращается как есть.
func expandIPRange(ipRange string) []string {
	var ips []string
	if strings.Contains(ipRange, "-") {
		parts := strings.Split(ipRange, "-")
		baseIP := parts[0]
		suffixes := strings.Split(baseIP, ".")
		prefix := strings.Join(suffixes[:3], ".") + "."

		start, _ := strconv.Atoi(suffixes[3])
		end, _ := strconv.Atoi(parts[1])

		for i := start; i <= end; i++ {
			ips = append(ips, fmt.Sprintf("%s%d", prefix, i))
		}
	} else {
		ips = append(ips, ipRange)
	}
	return ips
}

// ─── Сбор метрик ────────────────────────────────────────────────────────────

// getMetrics: пингует агента, читает строку AIDA64 по его адресу, парсит её и
// пингует все устройства агента.
func getMetrics(agent Agent) *Metrics {
	isOnline, latency := pingAddress(agent.Address)

	m := &Metrics{IsOnline: isOnline, Latency: latency}

	if isOnline {
		resp, err := http.Get(agent.Address)
		if err == nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			line := strings.TrimSpace(string(body))
			if parsed := parseAidaLine(line); parsed != nil {
				*m = *parsed
				m.IsOnline = true
				m.Latency = latency
			}
		}
	}

	for _, deviceRange := range agent.Devices {
		for _, ip := range expandIPRange(deviceRange) {
			alive, delay := pingAddress(ip)
			m.DevicePings = append(m.DevicePings, PingResult{Address: ip, IsAlive: alive, Latency: delay})
		}
	}

	return m
}

// ─── HTTP-сервер ────────────────────────────────────────────────────────────

func main() {
	loadAgents()

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// Список всех агентов.
	r.GET("/agents", func(c *gin.Context) {
		c.JSON(200, agents)
	})

	// Метрики одного агента.
	r.GET("/metrics/:agent_id", func(c *gin.Context) {
		id := c.Param("agent_id")
		agent, exists := agents[id]
		if !exists {
			c.JSON(404, gin.H{"error": "Agent not found"})
			return
		}
		c.JSON(200, getMetrics(agent))
	})

	// Метрики всех агентов сразу.
	r.GET("/metrics", func(c *gin.Context) {
		out := make(map[string]*Metrics, len(agents))
		for id, agent := range agents {
			out[id] = getMetrics(agent)
		}
		c.JSON(200, out)
	})

	// Health-check.
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "agents": len(agents)})
	})

	r.Run(":8080")
}
