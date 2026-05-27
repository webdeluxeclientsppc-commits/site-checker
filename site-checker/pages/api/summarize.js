export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { results } = req.body;
  if (!results || !results.length) return res.status(400).json({ error: 'No results provided' });

  const total = results.length;
  const critical = results.filter(r => r.status === 'critical').length;
  const warning = results.filter(r => r.status === 'warning').length;
  const ok = results.filter(r => r.status === 'ok').length;

  const criticalSites = results.filter(r => r.status === 'critical').map(r => {
    const issues = r.issues.filter(i => i.level === 'critical').map(i => i.text).join('; ');
    return `- ${r.name} (${r.url}): ${issues}`;
  }).join('\n');

  const warnSites = results.filter(r => r.status === 'warning').slice(0, 10).map(r => {
    const issues = r.issues.filter(i => i.level === 'warning').map(i => i.text).join('; ');
    return `- ${r.name}: ${issues}`;
  }).join('\n');

  const noGA = results.filter(r => !r.ga4 && !r.ga_ua).length;
  const noGTM = results.filter(r => !r.gtm).length;
  const noPhone = results.filter(r => !r.has_phone).length;
  const noForm = results.filter(r => !r.has_form && !r.calltracking).length;
  const noMessenger = results.filter(r => !r.has_messenger).length;
  const sslIssues = results.filter(r => !r.ssl_valid || r.ssl_days_left < 30).length;
  const noindex = results.filter(r => r.noindex).length;

  const prompt = `Ти асистент маркетолога який веде PPC рекламу в Google Ads. Проаналізуй результати автоматичної перевірки ${total} сайтів.

СТАТИСТИКА:
- Всього сайтів: ${total}
- Критичні проблеми: ${critical}
- Попередження: ${warning}
- Все ок: ${ok}

ТИПОВІ ПРОБЛЕМИ:
- Без GA4: ${noGA} сайтів
- Без GTM: ${noGTM} сайтів
- Без телефону tel:: ${noPhone} сайтів
- Без форм і колтрекінгу: ${noForm} сайтів
- Без месенджерів: ${noMessenger} сайтів
- Проблеми SSL: ${sslIssues} сайтів
- Noindex (невидимі): ${noindex} сайтів

КРИТИЧНІ САЙТИ:
${criticalSites || 'немає'}

САЙТИ З ПОПЕРЕДЖЕННЯМИ (перші 10):
${warnSites || 'немає'}

Надай короткий структурований звіт:
1. Загальна оцінка стану (1-2 речення)
2. Що критично і потребує негайної уваги (список)
3. Що важливо але не термінове (список)
4. Що загалом ок
5. Топ-3 рекомендації що зробити першочергово

Відповідай українською. Будь конкретним і практичним. Не більше 400 слів.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: 'Ти досвідчений PPC маркетолог. Відповідай чітко і по справі українською мовою.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.choices?.[0]?.message?.content || 'Не вдалося отримати аналіз';
    res.status(200).json({ summary: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
