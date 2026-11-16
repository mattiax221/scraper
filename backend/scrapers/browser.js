const { spawn } = require('child_process');

const DEBUG_PORT = 9340;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;

let launching = null;
let chromeProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isUp() {
  try {
    const response = await fetch(`${DEBUG_URL}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function launchChrome() {
  return new Promise((resolve, reject) => {
    const child = spawn('google-chrome', [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--user-data-dir=/tmp/usato-chrome-profile',
      '--window-size=1280,800',
      'about:blank',
    ], {
      stdio: 'ignore',
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
    });
    chromeProcess = child;
    child.unref();
    child.once('error', reject);
    child.once('exit', () => {
      if (chromeProcess === child) chromeProcess = null;
    });
    resolve(child);
  });
}

async function ensureChrome() {
  if (await isUp()) return;
  if (!launching) {
    launching = (async () => {
      await launchChrome();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await isUp()) return;
        await sleep(250);
      }
      throw new Error('Il browser di ricerca non si è avviato');
    })().finally(() => {
      launching = null;
    });
  }
  await launching;
}

function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'comando browser fallito'));
    else waiter.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('connessione al browser fallita')));
  });
  return {
    ws,
    ready: opened,
    send(method, params = {}, sessionId) {
      const id = seq + 1;
      seq = id;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(payload));
      });
    },
  };
}

const slots = { active: 0, queue: [] };

function withSlot(work) {
  return new Promise((resolve, reject) => {
    const start = () => {
      slots.active += 1;
      Promise.resolve()
        .then(work)
        .then(resolve, reject)
        .finally(() => {
          slots.active -= 1;
          const next = slots.queue.shift();
          if (next) next();
        });
    };
    if (slots.active < 2) start();
    else slots.queue.push(start);
  });
}

async function readPage(url, expression, timeoutMs, minCount = 8) {
  return withSlot(() => readPageNow(url, expression, timeoutMs, minCount));
}

async function readPageNow(url, expression, timeoutMs, minCount = 8) {
  await ensureChrome();
  const version = await fetch(`${DEBUG_URL}/json/version`).then((response) => response.json());
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.ready;
  let targetId = '';
  try {
    const created = await browser.send('Target.createTarget', { url });
    targetId = created.targetId;
    const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.sessionId;
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);

    const started = Date.now();
    let last = { done: false, items: [], title: '' };
    let previousCount = 0;
    let stableReads = 0;
    while (Date.now() - started < timeoutMs) {
      let evaluated;
      try {
        evaluated = await browser.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        }, sessionId);
      } catch (error) {
        if (/execution context/i.test(error.message)) {
          await sleep(400);
          continue;
        }
        throw error;
      }
      if (evaluated.exceptionDetails) {
        const detail = JSON.stringify(evaluated.exceptionDetails);
        if (/execution context/i.test(detail)) {
          await sleep(400);
          continue;
        }
        throw new Error('Lettura della pagina non riuscita');
      }
      last = evaluated.result.value || last;
      if (last.done) return last;
      const count = Array.isArray(last.items) ? last.items.length : 0;
      if (count >= minCount) return last;
      if (count > 0 && count === previousCount) {
        stableReads += 1;
        if (stableReads >= 3) return last;
      } else {
        stableReads = 0;
      }
      previousCount = count;
      await sleep(400);
    }
    return last;
  } finally {
    if (targetId) {
      await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    browser.ws.close();
  }
}

module.exports = { readPage };
