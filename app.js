const API_BASE = "https://api.frankfurter.dev/v1";

const PERIODS = [
  { days: 90, label: "90日" },
  { days: 365, label: "1年" },
  { days: 1095, label: "3年" },
  { days: 1825, label: "5年" },
  { days: 3650, label: "10年" },
];

// 5-tier rating based on where today's rate ranks among the last 90 days
// (percentile = share of days that were MORE expensive than today, i.e. how "cheap" today is)
const TIERS = [
  { min: 80, stars: 5, key: "tier-5", label: "絶好の両替タイミング" },
  { min: 60, stars: 4, key: "tier-4", label: "お得な水準" },
  { min: 40, stars: 3, key: "tier-3", label: "平均的な水準" },
  { min: 20, stars: 2, key: "tier-2", label: "やや割高な水準" },
  { min: 0, stars: 1, key: "tier-1", label: "割高な水準" },
];

const CURRENCIES = [
  { code: "USD", flag: "🇺🇸", label: "米ドル (アメリカ)" },
  { code: "EUR", flag: "🇪🇺", label: "ユーロ (欧州)" },
  { code: "GBP", flag: "🇬🇧", label: "英ポンド (イギリス)" },
  { code: "AUD", flag: "🇦🇺", label: "豪ドル (オーストラリア)" },
  { code: "CAD", flag: "🇨🇦", label: "加ドル (カナダ)" },
  { code: "CHF", flag: "🇨🇭", label: "スイスフラン" },
  { code: "NZD", flag: "🇳🇿", label: "NZドル (ニュージーランド)" },
  { code: "KRW", flag: "🇰🇷", label: "韓国ウォン" },
  { code: "HKD", flag: "🇭🇰", label: "香港ドル" },
  { code: "SGD", flag: "🇸🇬", label: "シンガポールドル" },
  { code: "THB", flag: "🇹🇭", label: "タイバーツ" },
  { code: "MYR", flag: "🇲🇾", label: "マレーシアリンギット" },
  { code: "PHP", flag: "🇵🇭", label: "フィリピンペソ" },
  { code: "IDR", flag: "🇮🇩", label: "インドネシアルピア" },
  { code: "CNY", flag: "🇨🇳", label: "中国人民元" },
];

const el = {
  currencySelect: document.getElementById("currency-select"),
  amountInput: document.getElementById("amount-input"),
  jpyAmount: document.getElementById("jpy-amount"),
  rateLine: document.getElementById("rate-line"),
  verdictBadge: document.getElementById("verdict-badge"),
  verdictStars: document.getElementById("verdict-stars"),
  verdictText: document.getElementById("verdict-text"),
  timingNote: document.getElementById("timing-note"),
  statCurrent: document.getElementById("stat-current"),
  statAverage: document.getElementById("stat-average"),
  statDiff: document.getElementById("stat-diff"),
  chartStatus: document.getElementById("chart-status"),
  canvas: document.getElementById("rate-chart"),
  staleNote: document.getElementById("stale-note"),
  periodSelect: document.getElementById("period-select"),
  statAverageLabel: document.getElementById("stat-average-label"),
  chartHeadingPeriod: document.getElementById("chart-heading-period"),
};

let state = {
  currency: "USD",
  periodDays: 90,
  latestRate: null, // JPY per 1 unit of foreign currency
  latestDate: null,
  history: [], // [{date, rate}]
};

function periodLabel(days) {
  return PERIODS.find((p) => p.days === days)?.label ?? `${days}日`;
}

function populateCurrencySelect() {
  el.currencySelect.innerHTML = CURRENCIES.map(
    (c) => `<option value="${c.code}">${c.flag} ${c.code} — ${c.label}</option>`
  ).join("");
  el.currencySelect.value = state.currency;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

let requestSeq = 0;

async function loadCurrency(code) {
  state.currency = code;
  el.rateLine.textContent = "レート取得中…";
  el.chartStatus.textContent = "";
  setVerdict(null, null, "判定中…");

  const thisRequest = ++requestSeq;
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - state.periodDays);

  try {
    const [latest, history] = await Promise.all([
      fetchJson(`${API_BASE}/latest?base=${code}&symbols=JPY`),
      fetchJson(`${API_BASE}/${formatDate(start)}..${formatDate(today)}?base=${code}&symbols=JPY`),
    ]);

    if (thisRequest !== requestSeq) return; // a newer request has since started

    state.latestRate = latest.rates.JPY;
    state.latestDate = latest.date;
    state.history = Object.entries(history.rates)
      .map(([date, r]) => ({ date, rate: r.JPY }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    renderAll();
  } catch (err) {
    if (thisRequest !== requestSeq) return;
    el.rateLine.textContent = "レートの取得に失敗しました。時間をおいて再読み込みしてください。";
    el.chartStatus.textContent = "グラフを表示できませんでした。";
    el.staleNote.hidden = true;
    setVerdict(null, null, "判定できません");
    console.error(err);
  }
}

function renderAll() {
  renderConversion();
  renderTiming();
  renderChart();
}

function renderConversion() {
  const amount = parseFloat(el.amountInput.value);
  if (!isFinite(amount) || state.latestRate === null) {
    el.jpyAmount.textContent = "----";
    return;
  }
  const jpy = amount * state.latestRate;
  el.jpyAmount.textContent = Math.round(jpy).toLocaleString("ja-JP");
  el.rateLine.textContent = `1 ${state.currency} = ${state.latestRate.toFixed(3)} 円（${state.latestDate} 時点 / ECB参考レート）`;

  el.staleNote.hidden = state.latestDate === formatDate(new Date());
}

function starsHTML(count) {
  return "★".repeat(count) + "☆".repeat(5 - count);
}

function setVerdict(tierKey, stars, text) {
  el.verdictBadge.classList.remove("is-tier-1", "is-tier-2", "is-tier-3", "is-tier-4", "is-tier-5");
  if (tierKey) el.verdictBadge.classList.add(`is-${tierKey}`);
  el.verdictStars.textContent = stars === null ? "" : starsHTML(stars);
  el.verdictText.textContent = text;
}

function renderTiming() {
  if (state.history.length === 0 || state.latestRate === null) return;

  const label = periodLabel(state.periodDays);
  el.statAverageLabel.textContent = `${label}平均`;

  const rates = state.history.map((h) => h.rate);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const diffPct = ((state.latestRate - avg) / avg) * 100;

  el.statCurrent.textContent = `${state.latestRate.toFixed(2)} 円`;
  el.statAverage.textContent = `${avg.toFixed(2)} 円`;
  el.statDiff.textContent = `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)} %`;

  // cheapness percentile: share of the period's days that were MORE expensive than today
  const moreExpensiveDays = rates.filter((r) => r > state.latestRate).length;
  const cheapPercentile = (moreExpensiveDays / rates.length) * 100;

  const tier = TIERS.find((t) => cheapPercentile >= t.min);
  setVerdict(tier.key, tier.stars, tier.label);
  el.timingNote.textContent =
    `直近${label}のうち${Math.round(cheapPercentile)}%の日より、今日の${state.currency}は円換算で安く両替できます` +
    `（${label}平均との差: ${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%）。`;
}

function renderChart() {
  const canvas = el.canvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 28, left: 56 };

  ctx.clearRect(0, 0, W, H);

  const styles = getComputedStyle(document.body);
  const inkColor = styles.getPropertyValue("--ink").trim() || "#1b2430";
  const mutedColor = styles.getPropertyValue("--muted").trim() || "#5b6472";
  const borderColor = styles.getPropertyValue("--border").trim() || "#dcd8cd";
  const accentColor = styles.getPropertyValue("--accent").trim() || "#b9812f";

  el.chartHeadingPeriod.textContent = `直近${periodLabel(state.periodDays)}`;

  if (state.history.length < 2) {
    el.chartStatus.textContent = "この通貨の履歴データが十分にありません。";
    return;
  }
  el.chartStatus.textContent = `${state.history[0].date} 〜 ${state.history[state.history.length - 1].date} のECB参考レート`;

  const rates = state.history.map((h) => h.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const xAt = (i) => pad.left + (i / (state.history.length - 1)) * plotW;
  const yAt = (v) => pad.top + (1 - (v - min) / range) * plotH;

  // gridlines + axis labels
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = mutedColor;
  ctx.font = "12px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "middle";

  [min, avg, max].forEach((v) => {
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(2), 4, y);
  });

  // average line (dashed, accent)
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(pad.left, yAt(avg));
  ctx.lineTo(W - pad.right, yAt(avg));
  ctx.stroke();
  ctx.restore();

  // rate line
  ctx.beginPath();
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 2;
  state.history.forEach((h, i) => {
    const x = xAt(i);
    const y = yAt(h.rate);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // current point
  const lastIdx = state.history.length - 1;
  ctx.beginPath();
  ctx.fillStyle = accentColor;
  ctx.arc(xAt(lastIdx), yAt(state.history[lastIdx].rate), 4, 0, Math.PI * 2);
  ctx.fill();

  // date labels (start / end)
  ctx.fillStyle = mutedColor;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(state.history[0].date, pad.left, H - pad.bottom + 8);
  ctx.textAlign = "right";
  ctx.fillText(state.history[lastIdx].date, W - pad.right, H - pad.bottom + 8);
  ctx.textAlign = "left";
}

function setActivePeriodButton() {
  el.periodSelect.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.days) === state.periodDays);
  });
}

el.currencySelect.addEventListener("change", (e) => loadCurrency(e.target.value));
el.amountInput.addEventListener("input", renderConversion);
el.periodSelect.addEventListener("click", (e) => {
  const btn = e.target.closest(".period-btn");
  if (!btn) return;
  const days = Number(btn.dataset.days);
  if (days === state.periodDays) return;
  state.periodDays = days;
  setActivePeriodButton();
  loadCurrency(state.currency);
});
window.addEventListener("resize", () => {
  if (state.history.length) renderChart();
});

populateCurrencySelect();
setActivePeriodButton();
loadCurrency(state.currency);
