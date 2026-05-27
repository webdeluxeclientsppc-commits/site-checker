import https from 'https';
import http from 'http';
import { URL } from 'url';

export const config = {
  maxDuration: 10,
};

const TIMEOUT = 7000;

function fetchPage(rawUrl, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 3) return resolve({ ok: false, error: 'Too many redirects', status: 0, html: '', ms: 0 });
    let url;
    try { url = new URL(rawUrl); } catch { return resolve({ ok: false, error: 'Невірний URL', status: 0, html: '', ms: 0 }); }
    const proto = url.protocol === 'https:' ? https : http;
    const start = Date.now();
    try {
      const req = proto.get(rawUrl, {
        timeout: TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'uk,en;q=0.9',
        },
        rejectUnauthorized: false,
      }, (res) => {
        const status = res.statusCode;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          let loc = res.headers.location;
          if (!loc.startsWith('http')) loc = new URL(loc, rawUrl).href;
          return fetchPage(loc, redirectCount + 1).then(resolve);
        }
        let html = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { if (html.length < 200000) html += chunk; });
        res.on('end', () => resolve({ ok: status < 400, status, html, ms: Date.now() - start, error: null }));
        res.on('error', (e) => resolve({ ok: false, error: e.message, status, html: '', ms: Date.now() - start }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message, status: 0, html: '', ms: Date.now() - start }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout (7s)', status: 0, html: '', ms: TIMEOUT }); });
    } catch (e) {
      resolve({ ok: false, error: e.message, status: 0, html: '', ms: Date.now() - start });
    }
  });
}

function checkSSL(rawUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve({ valid: false, daysLeft: 0, error: 'bad url' }); }
    if (url.protocol !== 'https:') return resolve({ valid: false, daysLeft: 0, error: 'not https' });
    const port = parseInt(url.port) || 443;
    try {
      const socket = https.connect({ host: url.hostname, port, servername: url.hostname, rejectUnauthorized: false }, () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) { socket.end(); return resolve({ valid: false, daysLeft: 0, error: 'no cert' }); }
          const daysLeft = Math.ceil((new Date(cert.valid_to) - Date.now()) / 86400000);
          socket.end();
          resolve({ valid: daysLeft > 0, daysLeft, expires: new Date(cert.valid_to).toISOString().split('T')[0] });
        } catch (e) { socket.end(); resolve({ valid: false, daysLeft: 0, error: e.message }); }
      });
      socket.on('error', (e) => resolve({ valid: false, daysLeft: 0, error: e.message }));
      socket.setTimeout(5000, () => { socket.destroy(); resolve({ valid: false, daysLeft: 0, error: 'timeout' }); });
    } catch (e) {
      resolve({ valid: false, daysLeft: 0, error: e.message });
    }
  });
}

function analyzeHtml(html) {
  if (!html) return {};
  const results = {};

  results.ga4 = /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/i.test(html) || /googletagmanager\.com\/gtag\/js\?id=G-/i.test(html);
  results.ga4_id = (html.match(/['"]G-[A-Z0-9]{6,}/)?.[0] || '').replace(/['"]/g, '');
  results.ga_ua = /UA-\d{4,}-\d/i.test(html);
  results.gtm = /googletagmanager\.com\/gtm\.js\?id=GTM-/i.test(html) || /GTM-[A-Z0-9]{5,}/i.test(html);
  results.gtm_id = (html.match(/GTM-[A-Z0-9]{5,}/)?.[0] || '');
  results.gads = /googleadservices\.com|google_conversion|AW-\d{8,}/i.test(html);
  results.gads_id = (html.match(/AW-\d{8,}/)?.[0] || '');

  const formMatches = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  results.forms_count = formMatches.length;
  results.has_form = formMatches.length > 0;
  results.has_submit = /<input[^>]+type=['"]?submit|<button[^>]*type=['"]?submit|<button(?![^>]*type=)[^>]*>/i.test(html);

  results.binotel = /binotel\.ua|bingophone/i.test(html);
  results.ringostat = /ringostat\.com/i.test(html);
  results.calltouch = /calltouch\.(ru|ua)/i.test(html);
  results.calltracking = results.binotel || results.ringostat || results.calltouch;
  results.calltracking_name = [results.binotel && 'Binotel', results.ringostat && 'Ringostat', results.calltouch && 'Calltouch'].filter(Boolean).join(', ');

  const telMatches = html.match(/href=['"]tel:[^'"]+['"]/gi) || [];
  results.has_phone = telMatches.length > 0;
  results.phone_numbers = telMatches.map(m => m.replace(/href=['"]tel:([^'"]+)['"]/i, '$1')).filter(Boolean).slice(0, 3);

  results.whatsapp = /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send/i.test(html);
  results.telegram = /t\.me\/|telegram\.me\//i.test(html);
  results.viber = /viber:\/\/|viber\.com\/|vb\.me\//i.test(html);
  results.instagram = /instagram\.com\//i.test(html);
  results.has_messenger = results.whatsapp || results.telegram || results.viber || results.instagram;
  results.messengers_list = [results.whatsapp && 'WhatsApp', results.telegram && 'Telegram', results.viber && 'Viber', results.instagram && 'Instagram'].filter(Boolean).join(', ');

  results.noindex = /robots[^>]*noindex/i.test(html) || /<meta[^>]+noindex/i.test(html);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  results.title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ').substring(0, 80) : '';
  const descMatch = html.match(/<meta[^>]+name=['"]description['"][^>]+content=['"]([^'"]*)['"]/i);
  results.description = descMatch ? descMatch[1].trim().substring(0, 160) : '';

  return results;
}

export default async function handler(req, res) {
  // Always return JSON
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required' });

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;

  try {
    const [pageResult, sslResult] = await Promise.all([
      fetchPage(normalizedUrl),
      checkSSL(normalizedUrl),
    ]);

    const checks = analyzeHtml(pageResult.html);

    const result = {
      name: name || normalizedUrl,
      url: normalizedUrl,
      timestamp: new Date().toISOString(),
      site_ok: pageResult.ok,
      http_status: pageResult.status,
      load_time_ms: pageResult.ms,
      site_error: pageResult.error || null,
      ssl_valid: sslResult.valid,
      ssl_days_left: sslResult.daysLeft,
      ssl_expires: sslResult.expires || null,
      ga4: checks.ga4 || false,
      ga4_id: checks.ga4_id || '',
      ga_ua: checks.ga_ua || false,
      gtm: checks.gtm || false,
      gtm_id: checks.gtm_id || '',
      gads: checks.gads || false,
      gads_id: checks.gads_id || '',
      has_form: checks.has_form || false,
      forms_count: checks.forms_count || 0,
      calltracking: checks.calltracking || false,
      calltracking_name: checks.calltracking_name || '',
      has_phone: checks.has_phone || false,
      phone_numbers: checks.phone_numbers || [],
      whatsapp: checks.whatsapp || false,
      telegram: checks.telegram || false,
      viber: checks.viber || false,
      instagram: checks.instagram || false,
      messengers_list: checks.messengers_list || '',
      noindex: checks.noindex || false,
      title: checks.title || '',
      description: checks.description || '',
    };

    const issues = [];
    if (!result.site_ok) issues.push({ level: 'critical', text: `Сайт недоступний (${result.site_error || 'HTTP ' + result.http_status})` });
    if (result.site_ok && !result.ssl_valid) issues.push({ level: result.ssl_error === 'not https' ? 'warning' : 'critical', text: result.ssl_error === 'not https' ? 'Сайт без HTTPS' : `SSL проблема: ${sslResult.error}` });
    if (result.ssl_valid && result.ssl_days_left < 14) issues.push({ level: 'critical', text: `SSL закінчується через ${result.ssl_days_left} дн.` });
    else if (result.ssl_valid && result.ssl_days_left < 30) issues.push({ level: 'warning', text: `SSL закінчується через ${result.ssl_days_left} дн.` });
    if (!result.ga4 && !result.ga_ua) issues.push({ level: 'critical', text: 'Google Analytics не знайдено' });
    else if (result.ga_ua && !result.ga4) issues.push({ level: 'warning', text: 'Старий UA Analytics, GA4 відсутній' });
    if (!result.gtm) issues.push({ level: 'warning', text: 'GTM не знайдено' });
    if (!result.has_form && !result.calltracking) issues.push({ level: 'warning', text: 'Форм і колтрекінгу не знайдено' });
    if (!result.has_phone) issues.push({ level: 'warning', text: 'Немає клікабельного телефону (tel:)' });
    if (!result.has_messenger) issues.push({ level: 'info', text: 'Месенджерів не знайдено' });
    if (result.noindex) issues.push({ level: 'critical', text: 'Noindex — сторінка прихована від Google' });
    if (result.load_time_ms > 5000) issues.push({ level: 'warning', text: `Повільне завантаження: ${(result.load_time_ms / 1000).toFixed(1)}с` });

    result.issues = issues;
    result.critical_count = issues.filter(i => i.level === 'critical').length;
    result.warning_count = issues.filter(i => i.level === 'warning').length;
    result.status = result.critical_count > 0 ? 'critical' : result.warning_count > 0 ? 'warning' : 'ok';

    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({
      name: name || normalizedUrl,
      url: normalizedUrl,
      timestamp: new Date().toISOString(),
      site_ok: false,
      status: 'critical',
      issues: [{ level: 'critical', text: `Помилка перевірки: ${e.message}` }],
      critical_count: 1,
      warning_count: 0,
    });
  }
}
