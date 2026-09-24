// pluto-relay — лёгкий агент на ПК (Windows/Linux).
// Пингует устройства, доступные только этой машине (VLAN/NAT), по запросу ядра.
// Один бинарник, без зависимостей. Слушает :8091.
//
// Сборка под Windows:  GOOS=windows GOARCH=amd64 go build -o pluto-relay.exe .
// Запуск:              pluto-relay.exe            (или службой: pluto-relay.exe -install)
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type PingResult struct {
	IP        string  `json:"ip"`
	Alive     bool    `json:"alive"`
	// LatencyMs — RTT с точностью до сотых мс (как его вернула утилита ping).
	// Дробная часть важна: при округлении до целых реальные 1.2–1.4 мс
	// превращаются в «1», и показания PLUTO расходятся с «ping» из консоли.
	LatencyMs *float64 `json:"latencyMs"`
}

var pingTimeRe = regexp.MustCompile(`(?i)time[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*ms`)

// pingOne пингует один адрес системной утилитой ping (есть и в Windows, и в Linux).
func pingOne(ip string, timeoutMs int) PingResult {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "1", "-w", strconv.Itoa(timeoutMs), ip)
	} else {
		cmd = exec.Command("ping", "-c", "1", "-W", strconv.Itoa(timeoutMs/1000+1), ip)
	}
	start := time.Now()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return PingResult{IP: ip, Alive: false, LatencyMs: nil}
	}
	// Приоритет — задержке из вывода самой утилиты ping («time=X ms»):
	// wall-time включает спавн процесса и добавляет 5-20 мс шума.
	var ms float64
	if loc := pingTimeRe.FindSubmatchIndex(out); loc != nil {
		// Windows-локали используют запятую как десятичный разделитель («время=1,23мс»).
		v, perr := strconv.ParseFloat(strings.ReplaceAll(string(out[loc[2]:loc[3]]), ",", "."), 64)
		if perr == nil && v > 0 {
			// Округляем до сотых мс — сохраняем точность утилиты ping.
			ms = math.Round(v*100) / 100
		} else {
			ms = float64(time.Since(start).Microseconds()) / 1000
		}
	} else {
		ms = float64(time.Since(start).Microseconds()) / 1000
	}
	return PingResult{IP: ip, Alive: true, LatencyMs: &ms}
}

func main() {
	port := flag.Int("port", 8091, "порт relay")
	timeout := flag.Int("timeout", 2000, "таймаут одного пинга, мс")
	flag.Parse()

	mux := http.NewServeMux()

	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		targets := strings.Split(r.URL.Query().Get("targets"), ",")
		out := make([]PingResult, 0, len(targets))
		for _, t := range targets {
			t = strings.TrimSpace(t)
			if t == "" {
				continue
			}
			out = append(out, pingOne(t, *timeout))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": "pluto-relay"})
	})

	addr := fmt.Sprintf("0.0.0.0:%d", *port)
	log.Printf("[pluto-relay] слушаю %s (пингую локальные устройства по запросу ядра)", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
