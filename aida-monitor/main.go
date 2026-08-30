// PLUTO relay (aida-monitor) — лёгкий сервис для Windows-машин и VLAN.
//
// Ядро PLUTO опрашивает агентов само, но не может дотянуться до:
//   1) loopback-адресов (127.0.0.1) — AIDA64/Glances на самой машине;
//   2) устройств внутри чужого VLAN (разграничение сети).
// Этот сервис ставится внутри сети агента и даёт ядру три возможности:
//   GET /ping?targets=10.0.0.5,10.0.0.6   → [{"ip","alive","latencyMs"}]
//   GET /fetch?url=http://127.0.0.1:8090/ → тело страницы (text/plain)
//   GET /sse-stream?url=...               → прокси SSE-потока AIDA64 (реальное время)
//
// Никаких зависимостей, только стандартная библиотека Go:
//   go build -o aida-monitor.exe .   (или aida-monitor для Linux)
//   .\aida-monitor.exe               (слушает :8091)
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const listenAddr = ":8091"

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// pingAddress — кроссплатформенный пинг (Linux: -c, Windows: -n).
func pingAddress(addr string) (bool, int64) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "1", "-w", "2000", addr)
	} else {
		cmd = exec.Command("ping", "-c", "1", "-W", "2", addr)
	}
	start := time.Now()
	err := cmd.Run()
	return err == nil, time.Since(start).Milliseconds()
}

// handlePing — GET /ping?targets=ip1,ip2,...
func handlePing(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("targets")
	out := make([]map[string]interface{}, 0)
	for _, t := range strings.Split(raw, ",") {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		alive, ms := pingAddress(t)
		item := map[string]interface{}{"ip": t, "alive": alive, "latencyMs": nil}
		if alive {
			item["latencyMs"] = ms
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleFetch — GET /fetch?url=... — отдаёт тело страницы (для loopback-адресов).
func handleFetch(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "no url", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(target)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

// handleSSEStream — GET /sse-stream?url=... — проксирует SSE-поток AIDA64.
// Ядро подписывается на этот эндпоинт и получает обновления в реальном времени:
// AIDA64 шлёт «data: Simple1|CPUu 5%{|}Simple4|SSD 46°C» — значения текут живьём,
// в то время как сырой HTML страницы статичен.
func handleSSEStream(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "no url", http.StatusBadRequest)
		return
	}
	base := strings.TrimRight(target, "/")
	sseURL := base + "/sse"

	client := &http.Client{Timeout: 0} // поток живёт долго — таймаут только на чтение
	req, err := http.NewRequest("GET", sseURL, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("User-Agent", "pluto-relay")

	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf("upstream %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return // клиент (ядро) отключился
			}
			flusher.Flush()
		}
		if err != nil {
			return
		}
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", handlePing)
	mux.HandleFunc("/fetch", handleFetch)
	mux.HandleFunc("/sse-stream", handleSSEStream)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "service": "pluto-relay"})
	})

	log.Printf("[pluto-relay] старт на %s (ping / fetch / sse-stream)", listenAddr)
	log.Fatal(http.ListenAndServe(listenAddr, mux))
}
