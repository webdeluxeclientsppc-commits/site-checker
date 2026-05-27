export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

async function fetchPage(rawUrl, redirectCount = 0) {
  if (redirectCount > 3) return { ok: false, error: 'Too many redirects', status: 0, html: '', ms: 0 };
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk,en;q=0.9',
      },
    });
    clearTimeout(timer);
    const html = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, html: html.substring(0, 200000), ms: Date.now() - start, error: null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout (7s)' : e.message, status: 0, html: '', ms: Date.now() - start };
  }
}

async function checkSSL(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return { valid: false, daysLeft: 0, error: 'not https' };
    // Use SSL checker API
    const res = await fetch(`https://ssl-checker.io/api/v1/check/${url.hostname}`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.valid_till) {
        const daysLeft = Math.ceil((new Date(data.valid_till) - Date.now()) / 86400000);
        return { valid: daysLeft > 0, daysLeft, expires: data.valid_till.split('T')[0] };
      }
    }
    // Fallback: just check if https works
    const testRes = await fetch(rawUrl, { signal: AbortSignal.timeout(5000), redirect: 'follow' }).catch(() => null);
    if (testRes) return { valid: true, daysLeft: 90, expires: null };
    return { valid: false, daysLeft: 0, error: 'unreachable' };
  } catch (e) {
    return { valid: false, daysLeft: 0, error: e.message };
  }
}

function analyzeHtml(html) {
  if (!html) return {};
  const r = {};

  r.ga4 = /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/i.test(html) || /googletagmanager\.com\/gtag\/js\?id=G-/i.test(html);
  r.ga4_id = (html.match(/['"]G-[A-Z0-9]{6,}/)?.[0] || '').replace(/['"]/g, '');
  r.ga_ua = /UA-\d{4,}-\d/i.test(html);
  r.gtm = /googletagmanager\.com\/gtm\.js\?id=GTM-/i.test(html) || /GTM-[A-Z0-9]{5,}/i.test(html);
  r.gtm_id = (html.match(/GTM-[A-Z0-9]{5,}/)?.[0] || '');
  r.gads = /googleadservices\.com|google_conversion|AW-\d{8,}/i.test(html);
  r.gads_id = (html.match(/AW-\d{8,}/)?.[0] || '');

  const forms = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  r.forms_count = forms.length;
  r.has_form = forms.length > 0;
  r.has_submit = /<input[^>]+type=['"]?submit|<button[^>]*type=['"]?submit|<button(?![^>]*type=)[^>]*>/i.test(html);

  r.binotel = /binotel\.ua|bingophone/i.test(html);
  r.ringostat = /ringostat\.com/i.test(html);
  r.calltouch = /calltouch\.(ru|ua)/i.test(html);
  r.calltracking = r.binotel || r.ringostat || r.calltouch;
  r.calltracking_name = [r.binotel && 'Binotel', r.ringostat && 'Ringostat', r.calltouch && 'Calltouch'].filter(Boolean).join(', ');

  const tels = html.match(/href=['"]tel:[^'"]+['"]/gi) || [];
  r.has_phone = tels.length > 0;
  r.phone_numbers = tels.map(m => m.replace(/href=['"]tel:([^'"]+)['"]/i, '$1')).slice(0, 3);

  r.whatsapp = /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send/i.test(html);
  r.telegram = /t\.me\/|telegram\.me\//i.test(html);
  r.viber = /viber:\/\/|viber\.com\/|vb\.me\//i.test(html);
  r.instagram = /instagram\.com\//i.test(html);
  r.has_messenger = r.whatsapp || r.telegram || r.viber || r.instagram;
  r.messengers_list = [r.whatsapp && 'WhatsApp', r.telegram && 'Telegram', r.viber && 'Viber', r.instagram && 'Instagram'].filter(Boolean).join(', ');

  r.noindex = /robots[^>]*noindex/i.test(html) || /<meta[^>]+noindex/i.test(html);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  r.title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ').substring(0, 80) : '';
  const descMatch = html.match(/<meta[^>]+name=['"]description['"][^>]+content=['"]([^'"]*)['"]/i);
  r.description = descMatch ? descMatch[1].trim().substring(0, 160) : '';

  return r;
}

export default async function handler(req, res) {
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

    const c = analyzeHtml(pageResult.html);

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
      ga4: c.ga4 || false, ga4_id: c.ga4_id || '',
      ga_ua: c.ga_ua || false,
      gtm: c.gtm || false, gtm_id: c.gtm_id || '',
      gads: c.gads || false, gads_id: c.gads_id || '',
      has_form: c.has_form || false, forms_count: c.forms_count || 0,
      calltracking: c.calltracking || false, calltracking_name: c.calltracking_name || '',
      has_phone: c.has_phone || false, phone_numbers: c.phone_numbers || [],
      whatsapp: c.whatsapp || false, telegram: c.telegram || false,
      viber: c.viber || false, instagram: c.instagram || false,
      messengers_list: c.messengers_list || '',
      noindex: c.noindex || false,
      title: c.title || '', description: c.description || '',
    };

    const issues = [];
    if (!result.site_ok) issues.push({ level: 'critical', text: `Сайт недоступний (${result.site_error || 'HTTP ' + result.http_status})` });
    if (!result.ssl_valid) issues.push({ level: sslResult.error === 'not https' ? 'warning' : 'critical', text: sslResult.error === 'not https' ? 'Сайт без HTTPS' : `SSL проблема` });
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
      issues: [{ level: 'critical', text: `Помилка: ${e.message}` }],
      critical_count: 1, warning_count: 0,
    });
  }
}
