import https from 'https';
import http from 'http';
import { URL } from 'url';

const TIMEOUT = 12000;

function fetchPage(rawUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve({ ok: false, error: 'Невірний URL', status: 0, html: '', ms: 0 }); }
    const proto = url.protocol === 'https:' ? https : http;
    const start = Date.now();
    const req = proto.get(rawUrl, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteChecker/1.0)' },
      rejectUnauthorized: false,
    }, (res) => {
      const status = res.statusCode;
      // follow one redirect
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, rawUrl).href;
        return fetchPage(loc).then(resolve);
      }
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (html.length < 300000) html += chunk; });
      res.on('end', () => resolve({ ok: status < 400, status, html, ms: Date.now() - start, error: null, finalUrl: rawUrl }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message, status: 0, html: '', ms: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout', status: 0, html: '', ms: TIMEOUT }); });
  });
}

function checkSSL(rawUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve({ valid: false, daysLeft: 0, error: 'bad url' }); }
    if (url.protocol !== 'https:') return resolve({ valid: false, daysLeft: 0, error: 'not https' });
    const port = parseInt(url.port) || 443;
    const options = { host: url.hostname, port, servername: url.hostname, rejectUnauthorized: false };
    const socket = https.connect(options, () => {
      try {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) { socket.end(); return resolve({ valid: false, daysLeft: 0, error: 'no cert' }); }
        const exp = new Date(cert.valid_to);
        const daysLeft = Math.ceil((exp - Date.now()) / 86400000);
        socket.end();
        resolve({ valid: daysLeft > 0, daysLeft, expires: exp.toISOString().split('T')[0] });
      } catch(e) { socket.end(); resolve({ valid: false, daysLeft: 0, error: e.message }); }
    });
    socket.on('error', (e) => resolve({ valid: false, daysLeft: 0, error: e.message }));
    socket.setTimeout(8000, () => { socket.destroy(); resolve({ valid: false, daysLeft: 0, error: 'timeout' }); });
  });
}

function analyzeHtml(html, baseUrl) {
  const h = html.toLowerCase();
  const results = {};

  // GA4
  results.ga4 = /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/i.test(html) || /googletagmanager\.com\/gtag\/js\?id=G-/i.test(html);
  results.ga4_id = (html.match(/['"]G-[A-Z0-9]{8,}/)?.[0] || '').replace(/['"]/g, '');

  // UA (old GA)
  results.ga_ua = /UA-\d{4,}-\d/i.test(html);
  results.ga_ua_id = (html.match(/UA-\d{4,}-\d/)?.[0] || '');

  // GTM
  results.gtm = /googletagmanager\.com\/gtm\.js\?id=GTM-/i.test(html) || /GTM-[A-Z0-9]{5,}/i.test(html);
  results.gtm_id = (html.match(/GTM-[A-Z0-9]{5,}/)?.[0] || '');

  // Google Ads conversion
  results.gads = /googleadservices\.com|google_conversion|AW-\d{8,}/i.test(html);
  results.gads_id = (html.match(/AW-\d{8,}/)?.[0] || '');

  // Forms
  const formMatches = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  results.forms_count = formMatches.length;
  results.has_form = formMatches.length > 0;
  results.has_submit = /<input[^>]+type=['"]?submit['"]?|<button[^>]*type=['"]?submit['"]?|<button(?![^>]*type)[^>]*>/i.test(html);

  // Binotel / calltracking
  results.binotel = /binotel\.ua|bingophone/i.test(html);
  results.ringostat = /ringostat\.com/i.test(html);
  results.calltouch = /calltouch\.ru|calltouch\.ua/i.test(html);
  results.comagic = /comagic\.ru/i.test(html);
  results.calltracking = results.binotel || results.ringostat || results.calltouch || results.comagic;
  results.calltracking_name = [
    results.binotel && 'Binotel',
    results.ringostat && 'Ringostat',
    results.calltouch && 'Calltouch',
    results.comagic && 'CoMagic',
  ].filter(Boolean).join(', ');

  // Phone tel:
  const telMatches = html.match(/href=['"]tel:[^'"]+['"]/gi) || [];
  results.has_phone = telMatches.length > 0;
  results.phone_numbers = telMatches.map(m => m.replace(/href=['"]tel:([^'"]+)['"]/i, '$1')).filter(Boolean);

  // WhatsApp
  results.whatsapp = /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send/i.test(html);

  // Telegram
  results.telegram = /t\.me\/|telegram\.me\//i.test(html);

  // Viber
  results.viber = /viber:\/\/|viber\.com\/|vb\.me\//i.test(html);

  // Instagram
  results.instagram = /instagram\.com\//i.test(html);

  // Any messenger
  results.has_messenger = results.whatsapp || results.telegram || results.viber || results.instagram;
  results.messengers_list = [
    results.whatsapp && 'WhatsApp',
    results.telegram && 'Telegram',
    results.viber && 'Viber',
    results.instagram && 'Instagram',
  ].filter(Boolean).join(', ');

  // Broken links — count hrefs, flag empties/hashes only
  const hrefs = html.match(/href=['"][^'"]+['"]/gi) || [];
  results.links_total = hrefs.length;
  results.has_links = hrefs.length > 0;

  // Meta: title & description
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  results.title = titleMatch ? titleMatch[1].trim().substring(0, 80) : '';
  const descMatch = html.match(/<meta[^>]+name=['"]description['"][^>]+content=['"]([^'"]*)['"]/i)
    || html.match(/<meta[^>]+content=['"]([^'"]*)['"'][^>]+name=['"]description['"]/i);
  results.description = descMatch ? descMatch[1].trim().substring(0, 160) : '';

  // robots
  results.noindex = /robots[^>]*noindex/i.test(html) || /<meta[^>]+noindex/i.test(html);

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;

  const [pageResult, sslResult] = await Promise.all([
    fetchPage(normalizedUrl),
    checkSSL(normalizedUrl),
  ]);

  const checks = analyzeHtml(pageResult.html, normalizedUrl);

  const result = {
    name: name || normalizedUrl,
    url: normalizedUrl,
    timestamp: new Date().toISOString(),

    // Site availability
    site_ok: pageResult.ok,
    http_status: pageResult.status,
    load_time_ms: pageResult.ms,
    site_error: pageResult.error || null,

    // SSL
    ssl_valid: sslResult.valid,
    ssl_days_left: sslResult.daysLeft,
    ssl_expires: sslResult.expires || null,
    ssl_error: sslResult.error || null,

    // Analytics
    ga4: checks.ga4,
    ga4_id: checks.ga4_id,
    ga_ua: checks.ga_ua,
    ga_ua_id: checks.ga_ua_id,
    gtm: checks.gtm,
    gtm_id: checks.gtm_id,
    gads: checks.gads,
    gads_id: checks.gads_id,

    // Forms
    has_form: checks.has_form,
    forms_count: checks.forms_count,
    has_submit: checks.has_submit,

    // Calltracking
    calltracking: checks.calltracking,
    calltracking_name: checks.calltracking_name,

    // Contacts
    has_phone: checks.has_phone,
    phone_numbers: checks.phone_numbers,

    // Messengers
    whatsapp: checks.whatsapp,
    telegram: checks.telegram,
    viber: checks.viber,
    instagram: checks.instagram,
    messengers_list: checks.messengers_list,

    // SEO / tech
    noindex: checks.noindex,
    title: checks.title,
    description: checks.description,
    links_total: checks.links_total,
  };

  // Score: count critical issues
  const issues = [];
  if (!result.site_ok) issues.push({ level: 'critical', text: `Сайт недоступний (HTTP ${result.http_status || 'no response'})` });
  if (!result.ssl_valid) issues.push({ level: 'critical', text: result.ssl_error === 'not https' ? 'Сайт без HTTPS' : `SSL проблема: ${result.ssl_error}` });
  if (result.ssl_valid && result.ssl_days_left < 14) issues.push({ level: 'critical', text: `SSL закінчується через ${result.ssl_days_left} дн.` });
  if (result.ssl_valid && result.ssl_days_left < 30 && result.ssl_days_left >= 14) issues.push({ level: 'warning', text: `SSL закінчується через ${result.ssl_days_left} дн.` });
  if (!result.ga4 && !result.ga_ua) issues.push({ level: 'critical', text: 'Google Analytics не знайдено' });
  if (result.ga_ua && !result.ga4) issues.push({ level: 'warning', text: 'Використовується старий Universal Analytics (UA), GA4 не знайдено' });
  if (!result.gtm) issues.push({ level: 'warning', text: 'GTM не знайдено' });
  if (!result.has_form && !result.calltracking) issues.push({ level: 'warning', text: 'Форм і колтрекінгу не знайдено' });
  if (!result.has_phone) issues.push({ level: 'warning', text: 'Немає клікабельного телефону (tel:)' });
  if (!result.has_messenger) issues.push({ level: 'info', text: 'Жодного месенджера не знайдено' });
  if (result.noindex) issues.push({ level: 'critical', text: 'Сторінка має noindex — невидима для Google' });
  if (result.load_time_ms > 5000) issues.push({ level: 'warning', text: `Повільне завантаження: ${(result.load_time_ms/1000).toFixed(1)}с` });

  result.issues = issues;
  result.critical_count = issues.filter(i => i.level === 'critical').length;
  result.warning_count = issues.filter(i => i.level === 'warning').length;
  result.status = result.critical_count > 0 ? 'critical' : result.warning_count > 0 ? 'warning' : 'ok';

  res.status(200).json(result);
}
