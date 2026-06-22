import http from 'node:http';

const port = Number(process.env.CDP_PORT || 9224);
const url = process.env.TEST_URL || 'http://127.0.0.1:4173/index.html';

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function newPage() {
  const res = await request('PUT', '/json/new?about:blank');
  return JSON.parse(res.body).webSocketDebuggerUrl;
}

async function measure(label, opts = {}) {
  const ws = new WebSocket(await newPage());
  let id = 0;
  const pending = new Map();
  const events = [];

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method) events.push(message);
  };

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const messageId = ++id;
      pending.set(messageId, resolve);
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Performance.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  if (opts.mobile) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  if (opts.network) {
    await send('Network.emulateNetworkConditions', opts.network);
  }

  if (opts.cpuRate) {
    await send('Emulation.setCPUThrottlingRate', { rate: opts.cpuRate });
  }

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__vitals = { lcp: 0, cls: 0, longTasks: [] };
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) window.__vitals.lcp = last.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (error) {}
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (error) {}
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__vitals.longTasks.push({ start: entry.startTime, duration: entry.duration });
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch (error) {}
    `,
  });

  const loadPromise = new Promise((resolve) => {
    const timeout = setTimeout(resolve, 15000);
    const interval = setInterval(() => {
      if (events.some((event) => event.method === 'Page.loadEventFired')) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 50);
  });

  await send('Page.navigate', { url: `${url}?v=cdp-${Date.now()}-${Math.random()}` });
  await loadPromise;
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const result = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      const fcp = paints.find((paint) => paint.name === 'first-contentful-paint')?.startTime || 0;
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const lcp = window.__vitals?.lcp || lcpEntries.at(-1)?.startTime || 0;
      const longTasks = window.__vitals?.longTasks || [];
      const tbt = longTasks
        .filter((task) => task.start >= fcp && task.start <= 5000)
        .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
      const resources = performance.getEntriesByType('resource');
      const transfer = resources.reduce((sum, resource) => sum + (resource.transferSize || 0), 0);
      const imgTransfer = resources
        .filter((resource) => /\\.(png|jpg|jpeg|webp)(\\?|$)/i.test(resource.name))
        .reduce((sum, resource) => sum + (resource.transferSize || 0), 0);
      const cssTransfer = resources
        .filter((resource) => /\\.css(\\?|$)/i.test(resource.name))
        .reduce((sum, resource) => sum + (resource.transferSize || 0), 0);
      const jsTransfer = resources
        .filter((resource) => /\\.js(\\?|$)/i.test(resource.name))
        .reduce((sum, resource) => sum + (resource.transferSize || 0), 0);
      const speedIndexApprox = fcp && lcp ? fcp + ((lcp - fcp) * 0.55) : (lcp || fcp || nav.loadEventEnd);
      return {
        fcp,
        lcp,
        cls: window.__vitals?.cls || 0,
        tbt,
        speedIndexApprox,
        load: nav.loadEventEnd,
        dcl: nav.domContentLoadedEventEnd,
        resources: resources.length,
        transfer,
        imgTransfer,
        cssTransfer,
        jsTransfer
      };
    })()`,
  });

  await send('Page.close').catch(() => {});
  ws.close();
  return { label, ...result.result.result.value };
}

function summarize(runs) {
  const keys = ['fcp', 'lcp', 'tbt', 'cls', 'speedIndexApprox', 'load', 'transfer', 'imgTransfer', 'resources'];
  const out = {};
  for (const key of keys) {
    const values = runs.map((run) => run[key] || 0).sort((a, b) => a - b);
    out[key] = {
      median: values[Math.floor(values.length / 2)],
      min: values[0],
      max: values[values.length - 1],
    };
  }
  return out;
}

function roundNumbers(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === 'number' ? Math.round(item * 100) / 100 : item
  )));
}

const fast4g = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  connectionType: 'cellular4g',
};

const desktopRuns = [];
const mobileRuns = [];
for (let index = 0; index < 3; index += 1) desktopRuns.push(await measure('desktop'));
for (let index = 0; index < 3; index += 1) {
  mobileRuns.push(await measure('mobile-fast4g-cpu4x', {
    mobile: true,
    network: fast4g,
    cpuRate: 4,
  }));
}

console.log(JSON.stringify(roundNumbers({
  desktopRuns,
  mobileRuns,
  desktopSummary: summarize(desktopRuns),
  mobileSummary: summarize(mobileRuns),
}), null, 2));
