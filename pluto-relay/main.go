// pluto-relay — лёгкий агент на ПК (Windows/Linux).
// Пингует устройства, доступные только этой машине (VLAN/NAT), по запросу ядра.
// Один бинарник, без зависимостей. Слушает :8091.
//
// Точность измерений:
//   - каждое целевое устройство пингуется НЕ ОДНИМ пакетом, а серией из 10
//     пакетов по умолчанию (-count 10; флаг -i интервала нет — он требует
//     root на Linux): одиночный пакет даёт сильно зашумлённую выборку
//     (первый пакет после простоя ARP/кэш-дрейф, пересборки
//     NIC-power-management дают ложные «1 мс» и всплески);
//   - в ответ возвращаются min/avg/max и jitter (разброс min..max) по серии,
//     а также sent/received — сколько пакетов отправлено и принято за серию
//     (UI раскрашивает счётчик: жёлтый при 2 потерях из 10, красный при 3+);
//   - время HTTP-запроса к самому relay (relayRttMs) вычитается ядром из RTT
//     устройств, измеренного со стороны сервера, чтобы сетевой путь до агента
//     не примешивался к его локальным замерам.
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
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type PingResult struct {
	IP    string `json:"ip"`
	Alive bool   `json:"alive"`
	// LatencyMs — медиана RTT по серии пакетов с точностью до сотых мс
	// (как её вернула утилита ping). Дробная часть важна: при округлении
	// до целых реальные 1.2–1.4 мс превращаются в «1».
	LatencyMs *float64 `json:"latencyMs"`
	// Расширенная статистика серии (real measurements, не одно значение):
	MinMs      *float64 `json:"minMs,omitempty"`
	AvgMs      *float64 `json:"avgMs,omitempty"`
	MaxMs      *float64 `json:"maxMs,omitempty"`
	JitterMs   *float64 `json:"jitterMs,omitempty"`   // разброс min..max
	Sent       int      `json:"sent"`                 // пакетов отправлено
	Received   int      `json:"received"`             // ответов получено
	LossPct    *float64 `json:"lossPct,omitempty"`    // потери, %
}

// «time=1,23 ms» (Windows-локали используют запятую) — берём все вхождения серии.
var pingTimeRe = regexp.MustCompile(`(?i)time[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*ms`)

// parsePingTimes извлекает все RTT из вывода утилиты ping.
func parsePingTimes(out []byte) []float64 {
	var res []float64
	for _, m := range pingTimeRe.FindAllSubmatch(out, -1) {
		v, err := strconv.ParseFloat(strings.ReplaceAll(string(m[1]), ",", "."), 64)
		if err == nil && v >= 0 {
			res = append(res, v)
		}
	}
	return res
}

func pct(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Round(float64(len(sorted)-1) * q))
	return sorted[idx]
}

// pingSeries пингует адрес системной утилитой ping серией из count пакетов
// (параллельно для разных адресов) и возвращает честную статистику.
// Первый пакет серии отбрасывается из выборки RTT: после простоя он всегда
// аномальный (ARP-резолв, пробуждение NIC из energy-efficient ethernet),
// именно он и даёт ложные значения на ровном месте.
func pingSeries(ip string, timeoutMs, count int) PingResult {
	perPacketMs := timeoutMs / count
	if perPacketMs < 800 {
		perPacketMs = 800 // минимум на пакет, иначе серия гарантированно не успеет
	} else if perPacketMs > 2000 {
		perPacketMs = 2000
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Windows ping не поддерживает дробные интервалы: пакеты идут подряд,
		// -w задаёт таймаут ожидания ответа в мс.
		cmd = exec.Command("ping", "-n", strconv.Itoa(count), "-w", strconv.Itoa(perPacketMs), ip)
	} else {
		// -i 0.2 — межпакетный интервал 200 мс (без root допускается >= 0.2 с),
		// -W в секундах (целое, ceil от таймаута пакета).
		wSec := (perPacketMs + 999) / 1000
		if wSec < 1 {
			wSec = 1
		}
		cmd = exec.Command("ping", "-c", strconv.Itoa(count), "-i", "0.2", "-W", strconv.Itoa(wSec), ip)
	}
	out, err := cmd.Output()

	times := parsePingTimes(out)
	// Sent/Received — честный счётчик серии для UI («отправлено/принято»):
	// received = реально полученные ответы (без вычета warm-up), иначе при
	// потере 2 из 10 интерфейс показывал бы 3 потери.
	res := PingResult{IP: ip, Sent: count, Received: len(times)}
	if len(times) == 0 {
		_ = err // утилита вернула nonzero exit — устройство недоступно или потеряны все ответы
		return res
	}
	// Первый (warm-up) пакет отбрасывается только из выборки RTT
	// (min/avg/max/jitter), но учитывается в sent/received.
	measured := times
	if len(measured) >= 4 {
		measured = measured[1:]
	}
	loss := float64(count-len(times)) * 100 / float64(count)
	sorted := append([]float64(nil), measured...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	mn, mx := sorted[0], sorted[len(sorted)-1]
	var sum float64
	for _, v := range measured {
		sum += v
	}
	rt := round2(pct(sorted, 0.5)) // медиана — устойчивая к одиночным всплескам
	res.Alive = true
	res.LatencyMs = &rt
	minV, avgV, maxV, jitV, lossV := round2(mn), round2(sum/float64(len(measured))), round2(mx), round2(mx-mn), round2(loss)
	res.MinMs, res.AvgMs, res.MaxMs, res.JitterMs, res.LossPct = &minV, &avgV, &maxV, &jitV, &lossV
	return res
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// healthResult кэширует результат самотеста relay (локальный ping), чтобы
// не спавнить процесс ping на каждый HTTP-запрос ядра.
type healthEntry struct {
	result map[string]interface{}
	ts     time.Time
}

var (
	healthMu  sync.Mutex
	healthCch *healthEntry
)

func selfHealth(timeoutMs, count int) map[string]interface{} {
	healthMu.Lock()
	defer healthMu.Unlock()
	if healthCch != nil && time.Since(healthCch.ts) < 5*time.Second {
		return healthCch.result
	}
	self := pingSeries("127.0.0.1", timeoutMs, count)
	var lat interface{}
	if self.LatencyMs != nil {
		lat = *self.LatencyMs
	}
	hostname, _ := os.Hostname()
	healthCch = &healthEntry{
		ts: time.Now(),
		result: map[string]interface{}{
			"ok": self.Alive, "name": "pluto-relay", "host": hostname,
			"selfLatencyMs": lat,
		},
	}
	return healthCch.result
}

func main() {
	port := flag.Int("port", 8091, "порт relay")
	timeout := flag.Int("timeout", 2000, "суммарный бюджет времени на пинг одного устройства, мс")
	count := flag.Int("count", 10, "сколько ICMP-пакетов на устройство в серии для проверки сетевого статуса (по умолчанию 10; первый отбрасывается из RTT как warm-up)")
	concurrency := flag.Int("concurrency", 8, "сколько устройств пинговать параллельно")
	flag.Parse()

	if *count < 1 {
		*count = 1
	} else if *count > 16 {
		*count = 16
	}
	if *concurrency < 1 {
		*concurrency = 1
	} else if *concurrency > 32 {
		*concurrency = 32
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		raw := strings.FieldsFunc(r.URL.Query().Get("targets"), func(c rune) bool { return c == ',' || c == ' ' || c == '\n' })
		targets := make([]string, 0, len(raw))
		for _, t := range raw {
			t = strings.TrimSpace(t)
			if t != "" {
				targets = append(targets, t)
			}
		}
		// Параллельный опрос целей (иначе диапазон /24 пинговался бы ~минуту).
		out := make([]PingResult, len(targets))
		var wg sync.WaitGroup
		sem := make(chan struct{}, *concurrency)
		for i, t := range targets {
			wg.Add(1)
			go func(i int, t string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				out[i] = pingSeries(t, *timeout, *count)
			}(i, t)
		}
		wg.Wait()
		w.Header().Set("Content-Type", "application/json")
		// serverNowMs — время по часам relay на момент ответа: ядро сопоставляет
		// его со своим Date.now(), чтобы вычесть сетевой путь до агента из RTT.
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"results":     out,
			"count":       *count,
			"serverNowMs": time.Now().UnixMilli(),
		})
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(selfHealth(*timeout, *count))
	})

	addr := fmt.Sprintf("0.0.0.0:%d", *port)
	log.Printf("[pluto-relay] слушаю %s (серия из %d пакетов на устройство, параллельно %d целей)", addr, *count, *concurrency)
	log.Fatal(http.ListenAndServe(addr, mux))
}
