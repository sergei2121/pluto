// pluto-relay — «кусок PLUTO», который ставится на ПК и пингует устройства,
// доступные только этой машине (за NAT / в отдельном VLAN). Только пинг — ничего больше.
//
// Сборка (на том ПК, где будет работать):
//   go build -o pluto-relay.exe .        (Windows)
//   go build -o pluto-relay .            (Linux)
//
// Запуск:
//   pluto-relay -port 8091
//
// Ядро PLUTO обращается к нему: GET http://<ip-пк>:8091/ping?targets=10.0.0.5,10.0.0.6
// Ответ: [{"ip":"10.0.0.5","alive":true,"latency":3}, ...]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Result struct {
	IP      string `json:"ip"`
	Alive   bool   `json:"alive"`
	Latency *int   `json:"latency"` // мс, null если недоступен
}

var latencyRe = regexp.MustCompile(`(?i)(?:time|время)\s*[=<]\s*(\d+(?:[.,]\d+)?)\s*(?:мс|ms)`)

// pingOne выполняет один ICMP-эхо-запрос системной утилитой ping.
func pingOne(ip string, timeoutMs int) Result {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "1", "-w", strconv.Itoa(timeoutMs), ip)
	} else {
		cmd = exec.Command("ping", "-c", "1", "-W", strconv.Itoa((timeoutMs+999)/1000), ip)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return Result{IP: ip, Alive: false}
	}
	text := string(out)
	if m := latencyRe.FindStringSubmatch(text); m != nil {
		ms, _ := strconv.Atoi(strings.Replace(m[1], ",", "", 1))
		return Result{IP: ip, Alive: true, Latency: &ms}
	}
	zero := 1
	return Result{IP: ip, Alive: true, Latency: &zero}
}

func main() {
	port := flag.Int("port", 8091, "порт, на котором relay слушает запросы ядра")
	timeout := flag.Int("timeout", 1500, "таймаут одного пинга, мс")
	flag.Parse()

	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		raw := r.URL.Query().Get("targets")
		targets := strings.FieldsFunc(raw, func(c rune) bool { return c == ',' || c == ' ' })
		if len(targets) == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte("[]"))
			return
		}
		if len(targets) > 256 {
			targets = targets[:256]
		}
		results := make([]Result, 0, len(targets))
		for _, ip := range targets {
			results = append(results, pingOne(strings.TrimSpace(ip), *timeout))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "name": "pluto-relay", "version": "1.12.0"})
	})

	addr := fmt.Sprintf(":%d", *port)
	fmt.Printf("[pluto-relay] слушаю %s — пингую цели по запросу ядра PLUTO\n", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		fmt.Println("ошибка:", err)
	}
	_ = time.Second
}
