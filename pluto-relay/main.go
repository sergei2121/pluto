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
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type PingResult struct {
	IP        string   `json:"ip"`
	Alive     bool     `json:"alive"`
	LatencyMs *float64 `json:"latencyMs"`
}

// pingOne пингует один адрес системной утилитой ping (есть и в Windows, и в Linux).
func pingOne(ip string, timeoutMs int) PingResult {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "1", "-w", strconv.Itoa(timeoutMs), ip)
	} else {
		cmd = exec.Command("ping", "-c", "1", "-W", strconv.Itoa(timeoutMs/1000+1), ip)
	}
	start := time.Now()
	err := cmd.Run()
	ms := float64(time.Since(start).Milliseconds())
	if err != nil {
		return PingResult{IP: ip, Alive: false, LatencyMs: nil}
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
