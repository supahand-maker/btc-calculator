// ====== 환율/시세(실시간 + 실패 시 기본값) ======
let btcUsdRate = 65000;   // 참고용(BTC→USD)
let usdKrwRate = 1350;    // 참고용(USD→KRW)
let upbitBtcKrwRate = 0;  // 핵심: 업비트 1 BTC 원화 가격(trade_price)
let upbitUsdtKrwRate = 0; // 추가: 업비트 1 USDT 원화 가격(trade_price)

function fmt(n, maxFrac = 8) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function setRatesUI() {
  const up = document.getElementById("upbitBtcKrwRate");
  if (up) {
    up.textContent =
      (typeof upbitBtcKrwRate === "number" && upbitBtcKrwRate > 0)
        ? Math.round(upbitBtcKrwRate).toLocaleString()
        : "로딩 중...";
  }

  // 추가: 업비트 USDT→KRW 표시
  const usdtEl = document.getElementById("upbitUsdtKrwRate");
  if (usdtEl) {
    usdtEl.textContent =
      (typeof upbitUsdtKrwRate === "number" && upbitUsdtKrwRate > 0)
        ? fmt(upbitUsdtKrwRate, 2)
        : "로딩 중...";
  }

  document.getElementById("btcUsdRate").textContent = fmt(btcUsdRate, 2);
  document.getElementById("usdKrwRate").textContent = fmt(usdKrwRate, 2);

  // ===== 김프(추가) : +면 빨강 / -면 파랑 =====
  const kimpEl = document.getElementById("kimpRate");
  if (kimpEl) {
    const globalKrw = btcUsdRate * usdKrwRate;
    if (typeof upbitBtcKrwRate === "number" && upbitBtcKrwRate > 0 && globalKrw > 0) {
      const kimpPct = ((upbitBtcKrwRate - globalKrw) / globalKrw) * 100;

      kimpEl.classList.remove("kimp-plus", "kimp-minus");
      if (kimpPct > 0) kimpEl.classList.add("kimp-plus");
      else if (kimpPct < 0) kimpEl.classList.add("kimp-minus");

      const sign = kimpPct > 0 ? "+" : "";
      kimpEl.textContent = `${sign}${kimpPct.toFixed(2)}%`;
    } else {
      kimpEl.classList.remove("kimp-plus", "kimp-minus");
      kimpEl.textContent = "로딩 중...";
    }
  }
}

async function fetchWithTimeout(url, ms = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRates() {
  // 기본값 즉시 표시(로딩중 멈춤 방지)
  setRatesUI();

  // 0) 업비트 KRW-BTC, KRW-USDT 현재가(trade_price)
  // markets 파라미터는 콤마로 여러 마켓 코드 지정 가능 [web:419][web:212]
  try {
    const jUp = await fetchWithTimeout(
      "https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-USDT"
    );

    const btc = jUp?.find?.(x => x.market === "KRW-BTC");
    const usdt = jUp?.find?.(x => x.market === "KRW-USDT");

    const vBtc = btc?.trade_price;
    const vUsdt = usdt?.trade_price;

    if (typeof vBtc === "number" && vBtc > 0) upbitBtcKrwRate = vBtc;
    if (typeof vUsdt === "number" && vUsdt > 0) upbitUsdtKrwRate = vUsdt;
  } catch (e) {
    console.warn("Upbit ticker fetch 실패:", e);
  }

  // 1) BTC/USD (CoinGecko) — 화면 표시/참고용
  try {
    const j1 = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const v1 = j1?.bitcoin?.usd;
    if (typeof v1 === "number" && v1 > 0) btcUsdRate = v1;
  } catch (e) {
    console.warn("BTC/USD fetch 실패:", e);
  }

  // 2) USD/KRW (ER API) — 화면 표시/참고용
  try {
    const j2 = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD");
    const v2 = j2?.rates?.KRW;
    if (typeof v2 === "number" && v2 > 0) usdKrwRate = v2;
  } catch (e) {
    console.warn("USD/KRW fetch 실패:", e);
  }

  setRatesUI();
  // 시세 갱신 후 마지막 편집칸 기준으로 재계산
  recalcFrom(lastEdited);
}

// ====== 계산기 로직 ======
const SATS_PER_BTC = 100_000_000;
const MAX_BTC = 21_000_000;

const btcEl = document.getElementById("btcInput");
const satsEl = document.getElementById("satsInput");
const usdEl = document.getElementById("usdInput");
const krwEl = document.getElementById("krwInput");
const refreshBtn = document.getElementById("refreshBtn");

let lastEdited = "btc";
let updating = false;

function sanitizeTyping(raw) {
  raw = String(raw ?? "").replace(/,/g, "");
  let out = "";
  let dot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !dot) { out += "."; dot = true; }
  }
  return out;
}

function parseMaybe(raw) {
  const s = sanitizeTyping(raw).trim();
  if (s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function clampBtc(btc) {
  if (!Number.isFinite(btc)) return 0;
  return Math.min(Math.max(btc, 0), MAX_BTC);
}

// 업비트 가격이 있으면 KRW는 업비트 기준, 없으면 (임시로) 기존 글로벌 환산으로 대체
function krwPerBtc() {
  if (typeof upbitBtcKrwRate === "number" && upbitBtcKrwRate > 0) return upbitBtcKrwRate;
  return btcUsdRate * usdKrwRate;
}

function renderFromBtc(btc, skipField) {
  const b = clampBtc(btc);
  const kpb = krwPerBtc();

  if (skipField !== "btc") btcEl.value = (b === 0 ? "0" : b.toFixed(8));
  if (skipField !== "sats") satsEl.value = Math.round(b * SATS_PER_BTC).toLocaleString();
  if (skipField !== "usd") usdEl.value = fmt(b * btcUsdRate, 2);   // USD는 참고용으로 그대로
  if (skipField !== "krw") krwEl.value = fmt(b * kpb, 0);          // KRW는 업비트 기준
}

function recalcFrom(field) {
  if (updating) return;
  updating = true;
  try {
    let btc;

    if (field === "btc") {
      const n = parseMaybe(btcEl.value);
      if (n === null) return;
      btc = clampBtc(n);
      renderFromBtc(btc, "btc");
      return;
    }

    if (field === "sats") {
      const n = parseMaybe(satsEl.value);
      if (n === null) return;
      btc = clampBtc(n / SATS_PER_BTC);
      renderFromBtc(btc, "sats");
      return;
    }

    if (field === "usd") {
      const n = parseMaybe(usdEl.value);
      if (n === null) return;
      btc = clampBtc(n / btcUsdRate);
      renderFromBtc(btc, "usd");
      return;
    }

    if (field === "krw") {
      const n = parseMaybe(krwEl.value);
      if (n === null) return;
      const kpb = krwPerBtc();
      btc = clampBtc(n / kpb);
      renderFromBtc(btc, "krw");
      return;
    }
  } finally {
    updating = false;
  }
}

function finalize(field) {
  let btc = 0;

  if (field === "btc") {
    const n = parseMaybe(btcEl.value);
    btc = clampBtc(n ?? 0);
  } else if (field === "sats") {
    const n = parseMaybe(satsEl.value);
    btc = clampBtc((n ?? 0) / SATS_PER_BTC);
  } else if (field === "usd") {
    const n = parseMaybe(usdEl.value);
    btc = clampBtc((n ?? 0) / btcUsdRate);
  } else if (field === "krw") {
    const n = parseMaybe(krwEl.value);
    const kpb = krwPerBtc();
    btc = clampBtc((n ?? 0) / kpb);
  }

  renderFromBtc(btc, null);
}

function bind(el, name) {
  el.addEventListener("input", () => {
    lastEdited = name;

    const s = sanitizeTyping(el.value);
    el.value = s;

    if (name === "btc") {
      const n = parseMaybe(el.value);
      if (n !== null && n > MAX_BTC) el.value = String(MAX_BTC);
    }

    recalcFrom(name);
  });

  el.addEventListener("blur", () => finalize(name));
  el.addEventListener("change", () => finalize(name));
}

bind(btcEl, "btc");
bind(satsEl, "sats");
bind(usdEl, "usd");
bind(krwEl, "krw");

refreshBtn.addEventListener("click", fetchRates);

// 초기 상태
setRatesUI();
renderFromBtc(0, null);
fetchRates();
