import { useState, useRef } from 'react';
import Head from 'next/head';

const STATUS_COLOR = { ok: '#22c55e', warning: '#f59e0b', critical: '#ef4444', pending: '#94a3b8' };
const STATUS_LABEL = { ok: 'OK', warning: 'Увага', critical: 'Критично', pending: '...' };

function StatusDot({ status }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: STATUS_COLOR[status] || '#94a3b8', flexShrink: 0,
    }} />
  );
}

function Cell({ value, label, ok, warn }) {
  const color = value === true ? '#22c55e' : value === false ? '#ef4444' : '#94a3b8';
  const text = value === true ? '✓' : value === false ? '✗' : value || '—';
  return (
    <td style={{ padding: '6px 8px', fontSize: 12, color: typeof value === 'boolean' ? color : '#e2e8f0', whiteSpace: 'nowrap', borderBottom: '1px solid #1e293b' }}>
      {text}
    </td>
  );
}

function IssueTag({ issue }) {
  const colors = { critical: '#fca5a5', warning: '#fcd34d', info: '#93c5fd' };
  const bg = { critical: '#450a0a', warning: '#431407', info: '#0c1a3a' };
  return (
    <span style={{ display: 'inline-block', background: bg[issue.level], color: colors[issue.level], fontSize: 11, padding: '2px 7px', borderRadius: 4, margin: '2px 3px 2px 0', whiteSpace: 'nowrap' }}>
      {issue.text}
    </span>
  );
}

export default function Home() {
  const [sites, setSites] = useState([{ name: '', url: '' }]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('input');
  const [view, setView] = useState('issues');
  const fileRef = useRef();

  function addRow() { setSites(s => [...s, { name: '', url: '' }]); }
  function removeRow(i) { setSites(s => s.filter((_, j) => j !== i)); }
  function updateRow(i, field, val) { setSites(s => s.map((r, j) => j === i ? { ...r, [field]: val } : r)); }

  function parseCsv(text) {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(/[,;\t]/);
      const url = (parts[0] || '').trim().replace(/^["']|["']$/g, '');
      const name = (parts[1] || '').trim().replace(/^["']|["']$/g, '');
      return { url, name: name || url };
    }).filter(r => r.url);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCsv(ev.target.result);
      if (rows.length) setSites(rows);
    };
    reader.readAsText(file);
  }

  async function runChecks() {
    const validSites = sites.filter(s => s.url.trim());
    if (!validSites.length) return;
    setRunning(true);
    setResults([]);
    setSummary('');
    setProgress(0);
    setActiveTab('results');

    const res = [];
    for (let i = 0; i < validSites.length; i++) {
      setProgress(Math.round(((i) / validSites.length) * 100));
      setResults(prev => [...prev, { ...validSites[i], status: 'pending', issues: [] }]);
      try {
        const r = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: validSites[i].url, name: validSites[i].name }),
        });
        const data = await r.json();
        res.push(data);
        setResults(prev => prev.map((p, j) => j === i ? data : p));
      } catch (e) {
        const errResult = { ...validSites[i], status: 'critical', site_ok: false, issues: [{ level: 'critical', text: e.message }] };
        res.push(errResult);
        setResults(prev => prev.map((p, j) => j === i ? errResult : p));
      }
    }
    setProgress(100);
    setRunning(false);

    // Get AI summary
    setSummaryLoading(true);
    try {
      const sr = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: res }),
      });
      const sd = await sr.json();
      setSummary(sd.summary || '');
    } catch {}
    setSummaryLoading(false);
  }

  function exportCsv() {
    const cols = ['name','url','status','http_status','load_time_ms','ssl_valid','ssl_days_left','ga4','ga4_id','gtm','gtm_id','gads','has_form','forms_count','calltracking','calltracking_name','has_phone','phone_numbers','whatsapp','telegram','viber','instagram','messengers_list','noindex','title','issues'];
    const header = cols.join(',');
    const rows = results.map(r => cols.map(c => {
      let v = r[c];
      if (Array.isArray(v)) v = v.join(' | ');
      if (c === 'issues') v = (r.issues || []).map(i => `[${i.level}] ${i.text}`).join(' | ');
      if (typeof v === 'boolean') v = v ? 'Так' : 'Ні';
      if (v === null || v === undefined) v = '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `site-check-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  const critical = results.filter(r => r.status === 'critical').length;
  const warning = results.filter(r => r.status === 'warning').length;
  const ok = results.filter(r => r.status === 'ok').length;

  const cols = [
    { key: 'status', label: 'Статус' },
    { key: 'site_ok', label: 'Сайт' },
    { key: 'ssl_valid', label: 'SSL' },
    { key: 'ga4', label: 'GA4' },
    { key: 'gtm', label: 'GTM' },
    { key: 'gads', label: 'G.Ads' },
    { key: 'has_form', label: 'Форма' },
    { key: 'calltracking', label: 'Колтрек' },
    { key: 'has_phone', label: 'Тел.' },
    { key: 'whatsapp', label: 'WA' },
    { key: 'telegram', label: 'TG' },
    { key: 'viber', label: 'Viber' },
    { key: 'instagram', label: 'IG' },
    { key: 'noindex', label: 'noindex' },
  ];

  return (
    <>
      <Head>
        <title>Site Checker — PPC моніторинг</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #020817; color: #e2e8f0; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        ::selection { background: #3b82f6; color: #fff; }
        ::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        input, textarea { background: #0f172a; border: 1px solid #1e293b; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; outline: none; transition: border-color .2s; }
        input:focus, textarea:focus { border-color: #3b82f6; }
        button { cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; border: none; border-radius: 6px; transition: all .15s; }
        .btn-primary { background: #3b82f6; color: #fff; padding: 9px 20px; font-size: 14px; font-weight: 500; }
        .btn-primary:hover { background: #2563eb; }
        .btn-primary:disabled { background: #1e3a5f; color: #4a6fa5; cursor: not-allowed; }
        .btn-ghost { background: transparent; color: #94a3b8; border: 1px solid #1e293b; padding: 7px 16px; font-size: 13px; }
        .btn-ghost:hover { border-color: #334155; color: #e2e8f0; }
        .tab { background: transparent; color: #64748b; padding: 8px 18px; font-size: 14px; border-bottom: 2px solid transparent; border-radius: 0; }
        .tab.active { color: #e2e8f0; border-bottom-color: #3b82f6; }
        .tag-view { background: transparent; color: #64748b; padding: 5px 12px; font-size: 12px; border: 1px solid #1e293b; border-radius: 4px; }
        .tag-view.active { background: #1e293b; color: #e2e8f0; border-color: #334155; }
        table { border-collapse: collapse; width: 100%; }
        th { font-size: 11px; font-weight: 500; color: #64748b; text-align: left; padding: 6px 8px; border-bottom: 1px solid #1e293b; white-space: nowrap; position: sticky; top: 0; background: #0a1628; z-index: 2; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .summary-text { white-space: pre-wrap; line-height: 1.7; font-size: 14px; color: #cbd5e1; }
        .pulse { animation: pulse 1.5s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 20px' }}>
        {/* Header */}
        <header style={{ padding: '24px 0 0', borderBottom: '1px solid #0f172a', marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
            <h1 style={{ fontFamily: 'IBM Plex Mono', fontSize: 20, fontWeight: 500, color: '#e2e8f0', letterSpacing: '-0.5px' }}>
              <span style={{ color: '#3b82f6' }}>▸</span> site-checker
            </h1>
            <span style={{ fontSize: 12, color: '#475569', fontFamily: 'IBM Plex Mono' }}>PPC моніторинг v1.0</span>
          </div>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #0f172a' }}>
            {['input', 'results'].map(t => (
              <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                {t === 'input' ? '01 — Сайти' : `02 — Результати ${results.length ? `(${results.length})` : ''}`}
              </button>
            ))}
          </div>
        </header>

        {/* INPUT TAB */}
        {activeTab === 'input' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
              {/* Sites list */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>Список сайтів ({sites.length})</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-ghost" onClick={() => fileRef.current.click()}>↑ Завантажити CSV</button>
                    <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
                    <button className="btn-ghost" onClick={addRow}>+ Додати</button>
                  </div>
                </div>
                <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 32px', gap: 0, borderBottom: '1px solid #1e293b', padding: '6px 12px' }}>
                    <span style={{ fontSize: 11, color: '#475569' }}>НАЗВА ПРОЄКТУ</span>
                    <span style={{ fontSize: 11, color: '#475569' }}>URL</span>
                    <span />
                  </div>
                  <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                    {sites.map((s, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 32px', gap: 0, borderBottom: '1px solid #0d1526', alignItems: 'center' }}>
                        <input value={s.name} onChange={e => updateRow(i, 'name', e.target.value)} placeholder={`Проєкт ${i + 1}`}
                          style={{ border: 'none', borderRight: '1px solid #0d1526', borderRadius: 0, background: 'transparent', padding: '9px 12px', fontSize: 13 }} />
                        <input value={s.url} onChange={e => updateRow(i, 'url', e.target.value)} placeholder="https://example.com"
                          style={{ border: 'none', borderRadius: 0, background: 'transparent', padding: '9px 12px', fontSize: 13, fontFamily: 'IBM Plex Mono' }} />
                        <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: '#334155', fontSize: 16, padding: '0 8px', cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                  CSV формат: URL, Назва (одна пара на рядок)
                </div>
              </div>

              {/* Sidebar */}
              <div>
                <div style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Що перевіряємо</div>
                  {[
                    '✓ Доступність сайту (HTTP статус)',
                    '✓ SSL сертифікат + термін дії',
                    '✓ Google Analytics 4',
                    '✓ Google Tag Manager',
                    '✓ Google Ads конверсії',
                    '✓ Форми на сторінці',
                    '✓ Binotel / колтрекінг',
                    '✓ Клікабельний телефон (tel:)',
                    '✓ WhatsApp, Telegram, Viber, IG',
                    '✓ Noindex (невидима для Google)',
                    '✓ Title і Meta Description',
                  ].map((item, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#64748b', padding: '4px 0', borderBottom: '1px solid #0d1526' }}>
                      <span style={{ color: '#22c55e' }}>{item.split(' ')[0]}</span> {item.split(' ').slice(1).join(' ')}
                    </div>
                  ))}
                </div>
                <button className="btn-primary" style={{ width: '100%', padding: '12px', fontSize: 15 }}
                  onClick={runChecks} disabled={running || !sites.filter(s => s.url.trim()).length}>
                  {running ? `Перевіряємо... ${progress}%` : `▸ Перевірити ${sites.filter(s => s.url.trim()).length} сайтів`}
                </button>
                {running && (
                  <div style={{ marginTop: 10, background: '#0f172a', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#3b82f6', width: progress + '%', transition: 'width .3s' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* RESULTS TAB */}
        {activeTab === 'results' && (
          <div style={{ padding: '20px 0' }}>
            {results.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>◇</div>
                <div>Запусти перевірку на вкладці "Сайти"</div>
              </div>
            ) : (
              <>
                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Всього', val: results.length, color: '#94a3b8' },
                    { label: 'Критично', val: critical, color: '#ef4444' },
                    { label: 'Увага', val: warning, color: '#f59e0b' },
                    { label: 'OK', val: ok, color: '#22c55e' },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8, padding: '14px 16px' }}>
                      <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 28, fontWeight: 600, color, fontFamily: 'IBM Plex Mono' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* AI Summary */}
                <div style={{ background: '#060d1f', border: '1px solid #1e293b', borderRadius: 8, padding: 20, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>▸ AI Аналіз</span>
                    {!summaryLoading && !running && results.length > 0 && !summary && (
                      <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={async () => {
                        setSummaryLoading(true);
                        const sr = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) });
                        const sd = await sr.json(); setSummary(sd.summary || ''); setSummaryLoading(false);
                      }}>Отримати аналіз</button>
                    )}
                  </div>
                  {summaryLoading ? (
                    <div className="pulse" style={{ color: '#475569', fontSize: 14 }}>Аналізую результати...</div>
                  ) : summary ? (
                    <div className="summary-text">{summary}</div>
                  ) : (
                    <div style={{ color: '#334155', fontSize: 14 }}>Аналіз з'явиться після завершення перевірки</div>
                  )}
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['issues', 'table'].map(v => (
                      <button key={v} className={`tag-view ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
                        {v === 'issues' ? 'Проблеми' : 'Таблиця'}
                      </button>
                    ))}
                  </div>
                  <button className="btn-ghost" onClick={exportCsv} style={{ fontSize: 13 }}>↓ Експорт CSV для Sheets</button>
                </div>

                {/* Issues view */}
                {view === 'issues' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...results].sort((a, b) => {
                      const order = { critical: 0, warning: 1, ok: 2, pending: 3 };
                      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                    }).map((r, i) => (
                      <div key={i} style={{ background: '#0a0f1e', border: `1px solid ${r.status === 'critical' ? '#450a0a' : r.status === 'warning' ? '#431407' : '#1e293b'}`, borderRadius: 8, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r.issues?.length ? 8 : 0 }}>
                          <StatusDot status={r.status || 'pending'} />
                          <span style={{ fontWeight: 500, fontSize: 14 }}>{r.name}</span>
                          <span style={{ fontSize: 12, color: '#475569', fontFamily: 'IBM Plex Mono' }}>{r.url}</span>
                          {r.load_time_ms && <span style={{ fontSize: 11, color: '#334155', marginLeft: 'auto' }}>{(r.load_time_ms / 1000).toFixed(1)}с</span>}
                          <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                        </div>
                        {r.status === 'pending' && <div className="pulse" style={{ fontSize: 12, color: '#475569' }}>Перевіряємо...</div>}
                        {r.issues?.length > 0 && (
                          <div>{r.issues.map((iss, j) => <IssueTag key={j} issue={iss} />)}</div>
                        )}
                        {r.status === 'ok' && (
                          <div style={{ fontSize: 12, color: '#22c55e' }}>Всі перевірки пройдено успішно</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Table view */}
                {view === 'table' && (
                  <div style={{ overflowX: 'auto', background: '#0a0f1e', border: '1px solid #1e293b', borderRadius: 8 }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ minWidth: 160 }}>Сайт</th>
                          {cols.map(c => <th key={c.key}>{c.label}</th>)}
                          <th style={{ minWidth: 200 }}>Проблеми</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#060d1f' }}>
                            <td style={{ padding: '7px 8px', fontSize: 13, borderBottom: '1px solid #1e293b', maxWidth: 180 }}>
                              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                              <div style={{ fontSize: 11, color: '#475569', fontFamily: 'IBM Plex Mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</div>
                            </td>
                            {cols.map(c => {
                              if (c.key === 'status') return (
                                <td key={c.key} style={{ padding: '7px 8px', borderBottom: '1px solid #1e293b' }}>
                                  <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status] || '...'}</span>
                                </td>
                              );
                              if (c.key === 'noindex') return (
                                <td key={c.key} style={{ padding: '7px 8px', borderBottom: '1px solid #1e293b', fontSize: 12, color: r.noindex ? '#ef4444' : '#334155' }}>
                                  {r.noindex ? '⚠ так' : '—'}
                                </td>
                              );
                              const v = r[c.key];
                              return <Cell key={c.key} value={v} />;
                            })}
                            <td style={{ padding: '7px 8px', borderBottom: '1px solid #1e293b', fontSize: 12, color: '#94a3b8', maxWidth: 280 }}>
                              {r.issues?.map((iss, j) => (
                                <div key={j} style={{ color: iss.level === 'critical' ? '#fca5a5' : iss.level === 'warning' ? '#fcd34d' : '#93c5fd', marginBottom: 2 }}>
                                  {iss.text}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
