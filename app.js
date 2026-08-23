const API_BASE = "https://api.frankfurter.dev/v1";
const HISTORY_DAYS = 90;
const DIFF_THRESHOLD_PCT = 1.5; // this much away from the 90-day average counts as a clear signal

const CURRENCIES = [
  { code: "USD", label: "米ドル (アメリカ)" },
  { code: "EUR", label: "ユーロ (欧州)" },
  { code: "GBP", label: "英ポンド (イギリス)" },
  { code: "AUD", label: "豪ドル (オーストラリア)" },
  { code: "CAD", label: "加ドル (カナダ)" },
  { code: "CHF", label: "スイスフラン" },
  { code: "NZD", label: "NZドル (ニュージーランド)" },
  { code: "KRW", label: "韓国ウォン" },
  { code: "HKD", label: "香港ドル" },
  { code: "SGD", label: "シンガポールドル" },
  { code: "THB", label: "タイバーツ" },
  { code: "MYR", label: "マレーシアリンギット" },
  { code: "PHP", label: "フィリピンペソ" },
  { code: "IDR", label: "インドネシアルピア" },
  { code: "CNY", label: "中国人民元" },
];

const el = {
  currencySelect: document.getElementById("currency-select"),
  amountInput: document.getElementById("amount-input"),
  jpyAmount: document.getElementById("jpy-amount"),
  rateLine: document.getElementById("rate-line"),
  verdictBadge: document.getElementById("verdict-badge"),
  verdictText: document.getElementById("verdict-text"),
  timingNote: document.getElementById("timing-note"),
  statCurrent: document.getElementById("stat-current"),
  statAverage: document.getElementById("stat-average"),
  statDiff: document.getElementById("stat-diff"),
  chartStatus: document.getElementById("chart-status"),
  canvas: document.getElementById("rate-chart"),
};

let state = {
  currency: "USD",
  latestRate: null, // JPY per 1 unit of foreign currency
  latestDate: null,
  history: [], // [{date, rate}]
};

function populateCurrencySelect() {
  el.currencySelect.innerHTML = CURRENCIES.map(
    (c) => `<option value="${c.code}">${c.code} — ${c.label}</option>`
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

async function loadCurrency(code) {
  state.currency = code;
  el.rateLine.textContent = "レート取得中…";
  el.chartStatus.textContent = "";
  setVerdict("loading", "判定中…");

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - HISTORY_DAYS);

  try {
    const [latest, history] = await Promise.all([
      fetchJson(`${API_BASE}/latest?base=${code}&symbols=JPY`),
      fetchJson(`${API_BASE}/${formatDate(start)}..${formatDate(today)}?base=${code}&symbols=JPY`),
    ]);

    state.latestRate = latest.rates.JPY;
    state.latestDate = latest.date;
    state.history = Object.entries(history.rates)
      .map(([date, r]) => ({ date, rate: r.JPY }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    renderAll();
  } catch (err) {
    el.rateLine.textContent = "レートの取得に失敗しました。時間をおいて再読み込みしてください。";
    el.chartStatus.textContent = "グラフを表示できませんでした。";
    setVerdict("neutral", "判定できません");
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
}

function setVerdict(kind, text) {
  el.verdictBadge.classList.remove("is-good", "is-bad");
  if (kind === "good") el.verdictBadge.classList.add("is-good");
  if (kind === "bad") el.verdictBadge.classList.add("is-bad");
  el.verdictText.textContent = text;
}

function renderTiming() {
  if (state.history.length === 0 || state.latestRate === null) return;

  const rates = state.history.map((h) => h.rate);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const diffPct = ((state.latestRate - avg) / avg) * 100;

  el.statCurrent.textContent = `${state.latestRate.toFixed(2)} 円`;
  el.statAverage.textContent = `${avg.toFixed(2)} 円`;
  el.statDiff.textContent = `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)} %`;

  if (diffPct <= -DIFF_THRESHOLD_PCT) {
    setVerdict("good", "円高寄り・両替の買い時");
    el.timingNote.textContent = `今の ${state.currency} は直近90日平均より円換算で${Math.abs(diffPct).toFixed(1)}%安く両替できています。`;
  } else if (diffPct >= DIFF_THRESHOLD_PCT) {
    setVerdict("bad", "円安寄り・やや割高");
    el.timingNote.textContent = `今の ${state.currency} は直近90日平均より円換算で${diffPct.toFixed(1)}%割高です。急がないなら様子見も一案です。`;
  } else {
    setVerdict("neutral", "平均的な水準");
    el.timingNote.textContent = "直近90日平均とほぼ同じ水準です。突出したお得感・割高感はありません。";
  }
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

el.currencySelect.addEventListener("change", (e) => loadCurrency(e.target.value));
el.amountInput.addEventListener("input", renderConversion);
window.addEventListener("resize", () => {
  if (state.history.length) renderChart();
});

populateCurrencySelect();
loadCurrency(state.currency);
