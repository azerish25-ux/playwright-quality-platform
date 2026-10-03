/** Self-contained report assets. No CDN, telemetry, framework or network dependency. */
export const reportStyles = `
:root{color-scheme:light;--paper:#f5f3ed;--white:#fffefa;--ink:#242721;--muted:#60665c;--line:#d7d9cf;--green:#286144;--green-bg:#e6eee4;--red:#9b352b;--red-bg:#fae9e3;--amber:#815911;--amber-bg:#f4ead0;--focus:#3458bd}

*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:inherit;text-underline-offset:4px}
a:hover{color:var(--green)}
button,input,select{font:inherit}
button,select,summary{cursor:pointer}
button,input,select{min-height:44px;border:1px solid #a2a798;border-radius:3px;background:var(--white);color:var(--ink)}
button{padding:9px 15px;font-weight:650}
button:hover{background:#e9ebdf}
button:disabled{color:var(--muted);cursor:default;background:transparent;border-color:var(--line)}
:focus-visible{outline:3px solid var(--focus);outline-offset:4px}
[hidden]{display:none!important}
code,.mono,.eyebrow,.badge,.stat dd,.row-number{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
code{font-size:.86em;overflow-wrap:anywhere}
h1,h2,h3,p,dl{margin:0}
h1{font-size:clamp(36px,4.2vw,62px);line-height:1.06;letter-spacing:-.055em;font-weight:620;max-width:760px}
h2{font-size:24px;line-height:1.25;letter-spacing:-.035em}
h3{font-size:16px;line-height:1.4;font-weight:650;letter-spacing:-.015em}
small{font-size:12px}
.muted{color:var(--muted)}
.eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase}
.skip{position:absolute;left:24px;top:-90px;padding:12px;background:var(--ink);color:white;z-index:3}
.skip:focus{top:12px}
.shell{max-width:1440px;margin:auto;padding:0 48px}
.masthead{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:26px 0;border-bottom:1px solid var(--ink)}
.wordmark{font-size:23px;font-weight:780;letter-spacing:-1px;text-decoration:none}
.brand-mark{display:inline-block;width:22px;height:22px;vertical-align:-3px;border:2px solid var(--ink);margin-right:9px;position:relative}
.brand-mark:after{content:"";position:absolute;height:2px;width:10px;left:4px;top:9px;background:var(--ink)}
.masthead nav{display:flex;gap:24px;font-size:12px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:48px;padding:49px 0 34px}
.hero .eyebrow{margin-bottom:18px}
.hero p{margin-top:20px;max-width:660px;color:var(--muted)}
.run-reference{align-self:end;border-left:1px solid var(--line);padding-left:24px;min-width:0}
.run-reference dt{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-top:12px}
.run-reference dd{margin:3px 0 0;overflow-wrap:anywhere;font-size:12px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;font-size:10px;font-weight:650;line-height:1.5;border:1px solid currentColor;border-radius:2px;white-space:nowrap}
.badge:before{content:"";width:5px;height:5px;background:currentColor}
.tone-pass{color:var(--green);background:var(--green-bg)}
.tone-fail{color:var(--red);background:var(--red-bg)}
.tone-warn{color:var(--amber);background:var(--amber-bg)}
.tone-neutral{color:var(--muted);background:#eef0e7}
.summary-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:40px}
.stat{padding:19px 24px;border-left:1px solid var(--line)}
.stat:first-child{padding-left:0;border-left:0}
.stat dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.stat dd{font-size:36px;line-height:1.3;letter-spacing:-.06em;margin:6px 0 0}
.stat small{display:block;margin-top:3px;color:var(--muted)}
.workbench{display:grid;grid-template-columns:minmax(0,1fr) 278px;gap:38px;align-items:start}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:18px;margin-bottom:20px}
.section-heading .eyebrow{color:var(--muted)}
.filters{display:grid;grid-template-columns:minmax(140px,1fr) 170px 150px;gap:12px;padding:18px;background:#ebece3;border:1px solid var(--line)}
.filters label{min-width:0;font-size:11px;font-weight:650;letter-spacing:.03em}
.filters input,.filters select{min-width:0;width:100%;display:block;margin-top:6px;padding:10px;font-size:13px}
.filter-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:13px 0 20px;font-size:12px;color:var(--muted)}
.filter-meta button{min-height:36px;font-size:12px;padding:5px 10px}
.execution-list{border-top:1px solid var(--ink)}
.execution{padding:20px 0;border-bottom:1px solid var(--line)}
.execution-top{display:grid;grid-template-columns:25px minmax(0,1fr) auto;gap:13px;align-items:start}
.row-number{font-size:11px;color:var(--muted);padding-top:4px}
.execution-title{overflow-wrap:anywhere}
.execution-tags{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:5px;color:var(--muted);font-size:11px}
.execution-tags code{font-size:11px}
.execution-state{text-align:right}
.execution-state small{display:block;margin-top:7px;color:var(--muted)}
.execution details{margin:12px 0 0 38px}
.execution summary{font-size:12px;color:var(--muted);width:fit-content;padding:4px 0;min-height:28px}
.execution summary:hover{color:var(--ink)}
.evidence-detail{border:1px solid var(--line);background:var(--white);padding:20px;margin-top:12px}
.execution-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:22px}
.execution-meta dt{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
.execution-meta dd{font-size:12px;margin:4px 0 0;overflow-wrap:anywhere}
.history-note{font-size:12px;color:var(--muted);padding-bottom:16px}
.attempt{border-top:1px solid var(--line);padding-top:17px;margin-top:17px}
.attempt h4{font-size:12px;margin:0 0 12px;font-weight:650}
.attempt pre{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;background:#f2f2eb;padding:14px;border-left:2px solid #999f8f}
.artifacts{list-style:none;padding:0;margin:12px 0 0}
.artifacts li{padding:8px 0;font-size:12px;border-top:1px dashed var(--line);overflow-wrap:anywhere}
.artifacts .artifact-state{font-size:10px;text-transform:uppercase;color:var(--muted);margin-right:8px}
.empty{padding:46px 24px;text-align:center;border:1px dashed #9da493;background:var(--white)}
.empty h3{font-size:22px;margin-bottom:10px}
.empty p{color:var(--muted);max-width:390px;margin:0 auto 20px}
.rail{border-left:1px solid var(--line);padding-left:26px}
.rail section{padding-bottom:26px;margin-bottom:26px;border-bottom:1px solid var(--line)}
.rail section:last-child{border:0}
.rail h2{font-size:18px;margin-bottom:15px}
.rail .eyebrow{display:block;margin-bottom:10px;color:var(--muted)}
.rail p,.rail li{font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.rail p+p{margin-top:12px}
.rail ul{padding-left:16px;margin:12px 0 0}
.gate-status{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px}
.gate-status code{font-size:11px}
.rail-links{display:grid;gap:9px;margin-top:15px;font-size:12px}
.mini-stats{margin-top:14px}
.mini-stats div{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:8px 0;font-size:12px}
.mini-stats dt{color:var(--muted)}
.mini-stats dd{margin:0;font-family:ui-monospace,monospace}
.history{margin-top:38px;padding:27px 0;border-top:1px solid var(--ink)}
.history header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
.history p{font-size:12px;color:var(--muted);margin-top:12px;overflow-wrap:anywhere}
.history-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:22px}
.history-grid div{border-left:2px solid var(--line);padding-left:14px}
.history-grid dt{font-size:11px;color:var(--muted)}
.history-grid dd{margin:5px 0 0;font-size:22px;font-family:ui-monospace,monospace}
.footer{display:flex;justify-content:space-between;gap:24px;padding:25px 0 34px;margin-top:32px;border-top:1px solid var(--ink);font-size:11px;color:var(--muted)}
.footer p{max-width:680px}
.noscript{padding:16px;border:1px solid var(--line);margin-bottom:16px}

@media(min-width:1600px){.shell{padding:0 60px}
}
@media(max-width:1100px){.shell{padding:0 28px}
.workbench{grid-template-columns:minmax(0,1fr) 240px;gap:26px}
.rail{padding-left:20px}
.filters{grid-template-columns:1fr 1fr}
.filters label:first-child{grid-column:1/-1}
.hero{grid-template-columns:minmax(0,1fr) 220px;gap:30px}
}
@media(max-width:760px){.shell{padding:0 20px}
.masthead{padding:21px 0}
.masthead nav{gap:16px;font-size:11px}
.masthead nav a:nth-child(2){display:none}
.hero{grid-template-columns:1fr;padding:31px 0 25px;gap:23px}
.hero p{margin-top:16px}
.run-reference{border-left:0;border-top:1px solid var(--line);padding:13px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:10px 20px}
.run-reference dt{margin-top:0}
.summary-strip{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:30px}
.stat{padding:15px 17px}
.stat:nth-child(3){border-left:0;padding-left:0}
.stat:nth-child(n+3){border-top:1px solid var(--line)}
.stat dd{font-size:30px}
.workbench{display:flex;flex-direction:column;gap:28px}
.test-area,.rail{width:100%;min-width:0}
.rail{border-left:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:22px}
.rail section{margin:0;padding:22px 0 0;border-top:1px solid var(--line);border-bottom:0}
.rail section:first-child{grid-column:1/-1}
.section-heading{align-items:flex-start;flex-direction:column;gap:7px}
.execution-top{grid-template-columns:20px minmax(0,1fr);gap:9px}
.execution-state{grid-column:2;text-align:left;display:flex;align-items:center;gap:12px}
.execution-state small{margin:0}
.execution details{margin-left:29px}
.evidence-detail{padding:14px}
.history-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.history header{align-items:flex-start;flex-direction:column}
.footer{flex-direction:column;gap:12px}
}
@media(max-width:380px){.shell{padding:0 14px}
.filters{padding:12px;gap:10px}
.rail{grid-template-columns:1fr}
.rail section:first-child{grid-column:auto}
.execution-meta{grid-template-columns:1fr}
.stat{padding-right:6px}
.masthead nav{gap:12px}
.history-grid{gap:12px}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}
}
@media print{body{background:white}
.shell{max-width:none;padding:0}
.skip,.filters,.filter-meta,nav,#empty-filter{display:none!important}
.workbench{display:block}
.rail{border:0;padding:24px 0;display:block}
.execution[hidden]{display:block!important}
.execution{break-inside:avoid}
.hero{padding-top:24px}
.summary-strip{margin-bottom:24px}
.badge{background:transparent}
.footer{margin-top:20px}
}

`;

export const reportScript = `
(() => {
  const search = document.getElementById('search');
  const outcome = document.getElementById('outcome');
  const sort = document.getElementById('sort');
  const list = document.getElementById('executions');
  const rows = Array.from(list.querySelectorAll('.execution'));
  const count = document.getElementById('result-count');
  const empty = document.getElementById('empty-filter');
  const clear = document.getElementById('clear-filters');
  const reset = document.getElementById('reset-filters');
  const allowed = (select, value) => Array.from(select.options).some(option => option.value === value);
  function apply(writeUrl = true) {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    rows.sort((a, b) => sort.value === 'duration'
      ? Number(b.dataset.duration) - Number(a.dataset.duration) || Number(a.dataset.index) - Number(b.dataset.index)
      : sort.value === 'name'
        ? a.dataset.search.localeCompare(b.dataset.search) || Number(a.dataset.index) - Number(b.dataset.index)
        : Number(b.dataset.attention) - Number(a.dataset.attention) || Number(a.dataset.index) - Number(b.dataset.index));
    for (const row of rows) {
      row.hidden = !(row.dataset.search.toLocaleLowerCase().includes(query) && (outcome.value === 'all' || row.dataset.outcome === outcome.value));
      if (!row.hidden) visible++;
      list.append(row);
    }
    count.textContent = visible + ' of ' + rows.length + ' executions';
    empty.hidden = visible !== 0 || rows.length === 0;
    clear.disabled = !search.value && outcome.value === 'all' && sort.value === 'attention';
    if (writeUrl) {
      try {
        const url = new URL(location.href);
        for (const [key, value, fallback] of [['q', search.value, ''], ['outcome', outcome.value, 'all'], ['sort', sort.value, 'attention']]) {
          if (value === fallback) url.searchParams.delete(key); else url.searchParams.set(key, value);
        }
        history.replaceState(null, '', url);
      } catch { /* File previews can refuse history changes; filtering still works. */ }
    }
  }
  function restore() {
    const params = new URLSearchParams(location.search);
    search.value = params.get('q') || '';
    outcome.value = allowed(outcome, params.get('outcome')) ? params.get('outcome') : 'all';
    sort.value = allowed(sort, params.get('sort')) ? params.get('sort') : 'attention';
    apply(false);
  }
  function resetFilters() { search.value = ''; outcome.value = 'all'; sort.value = 'attention'; apply(); search.focus(); }
  search.addEventListener('input', () => apply());
  outcome.addEventListener('change', () => apply());
  sort.addEventListener('change', () => apply());
  clear.addEventListener('click', resetFilters);
  reset.addEventListener('click', resetFilters);
  window.addEventListener('popstate', restore);
  document.querySelector('.filters').hidden = false;
  document.querySelector('.filter-meta').hidden = false;
  restore();
})();
`;
