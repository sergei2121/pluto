// ─── Планировщик проверок/опросов с ограничением параллелизма ──────────────
export const MAX_CONCURRENT = 8;

let running = 0;
const queue = [];

/** Ставит задачу в очередь и освобождает слоты. */
export function enqueue(task) {
  queue.push(task);
  runNext();
}

/** Запускает накопленные задачи, пока есть свободные слоты. */
export function runNext() {
  while (running < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    running++;
    task().finally(() => { running--; runNext(); });
  }
}
