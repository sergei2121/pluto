const http = require('http');
const https = require('https');

// Замените на ваш реальный IP адрес Glances сервера
const GLANCES_URL = process.argv[2] || 'http://x.x.x.x:61208';

console.log(`Тестирование подключения к Glances: ${GLANCES_URL}`);
console.log('=' .repeat(60));

function fetchText(rawUrl, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let u;
    try { 
      u = new URL(rawUrl); 
    } catch { 
      return reject(new Error('некорректный адрес')); 
    }
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.get(u, { 
      timeout: timeoutMs, 
      headers: { 
        'Connection': 'close',
        'Accept': 'application/json'
      } 
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, u).toString(), timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { 
        res.resume(); 
        return reject(new Error(`HTTP ${res.statusCode}`)); 
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    r.on('timeout', () => r.destroy(new Error('таймаут запроса')));
    r.on('error', (e) => reject(e));
  });
}

async function testGlances() {
  const base = GLANCES_URL.replace(/\/+$/, '');
  
  // Тест 1: API v4
  console.log('\n[1] Проверка API v4...');
  try {
    const txt = await fetchText(`${base}/api/4/all`, 7000);
    const data = JSON.parse(txt);
    console.log('✓ API v4 успешно!');
    console.log(`  CPU: ${data.cpu?.total ?? 'N/A'}%`);
    console.log(`  RAM: ${data.mem?.percent ?? 'N/A'}%`);
    console.log(`  Uptime: ${data.uptime ?? 'N/A'}`);
    if (data.network && data.network.length > 0) {
      console.log(`  Network interfaces: ${data.network.length}`);
    }
    return { success: true, version: 'v4', data };
  } catch (e) {
    console.log(`✗ API v4 ошибка: ${e.message}`);
  }
  
  // Тест 2: API v3
  console.log('\n[2] Проверка API v3...');
  try {
    const txt = await fetchText(`${base}/api/3/all`, 7000);
    const data = JSON.parse(txt);
    console.log('✓ API v3 успешно!');
    console.log(`  CPU: ${data.cpu?.total ?? 'N/A'}%`);
    console.log(`  RAM: ${data.mem?.percent ?? 'N/A'}%`);
    console.log(`  Uptime: ${data.uptime ?? 'N/A'}`);
    return { success: true, version: 'v3', data };
  } catch (e) {
    console.log(`✗ API v3 ошибка: ${e.message}`);
  }
  
  // Тест 3: Главная страница HTML
  console.log('\n[3] Проверка HTML страницы...');
  try {
    const html = await fetchText(base, 7000);
    console.log('✓ HTML страница доступна!');
    console.log(`  Размер HTML: ${html.length} байт`);
    
    // Парсинг основных метрик из HTML
    const cpuMatch = html.match(/cpu[^"]*?data-value=["']([^"']+)/i);
    const memMatch = html.match(/mem[^"]*?data-value=["']([^"']+)/i);
    
    if (cpuMatch) console.log(`  CPU из HTML: ${parseFloat(cpuMatch[1])}%`);
    if (memMatch) console.log(`  RAM из HTML: ${parseFloat(memMatch[1])}%`);
    
    return { success: true, version: 'html', html: html.substring(0, 500) + '...' };
  } catch (e) {
    console.log(`✗ HTML ошибка: ${e.message}`);
  }
  
  // Тест 4: Проверка базового подключения
  console.log('\n[4] Проверка базового подключения...');
  try {
    const txt = await fetchText(base, 5000);
    console.log('✓ Базовое подключение успешно!');
    return { success: true, version: 'basic' };
  } catch (e) {
    console.log(`✗ Базовое подключение ошибка: ${e.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('❌ Glances недоступен по указанному адресу');
  console.log('Проверьте:');
  console.log('  1. Правильность IP адреса и порта');
  console.log('  2. Что Glances запущен и слушает порт 61208');
  console.log('  3. Настройки брандмауэра');
  console.log('  4. Сетевую доступность между серверами');
  
  return { success: false };
}

testGlances().then(result => {
  console.log('\n' + '='.repeat(60));
  if (result.success) {
    console.log('✅ Glances доступен!');
    console.log(`Метод получения данных: ${result.version}`);
  } else {
    console.log('❌ Не удалось подключиться к Glances');
    process.exit(1);
  }
}).catch(err => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
