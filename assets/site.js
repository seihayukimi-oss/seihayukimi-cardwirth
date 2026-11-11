// 公開ページの動き（DL数・並べ替え・検索・DLキー）。ページの中身は、公開のときに出来上がった HTML で入っている
import { decryptBytes, sha256Hex } from "./enc.js";

const site = JSON.parse(document.getElementById("cw-site")?.textContent || "{}");
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// ---- DL数：GitHub の Releases が数えている回数。読めなければ、公開のときの控えのまま ----
async function loadCounts() {
  const KEY = "cwok-counts";
  try { const c = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (c && Date.now() - c.t < 5 * 60 * 1000) return c.v; } catch {}
  try {
    const r = await fetch(`https://api.github.com/repos/${site.repo}/releases/tags/${site.tag}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const v = {};
    for (const a of (await r.json()).assets || []) { const m = /^c(\d+)\.txt$/.exec(a.name); if (m) v[m[1]] = a.download_count; }
    try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  } catch { return null; }
}
// DL数を1つ進める（数える用の小さなファイルを取得するだけ。失敗しても何もしない）
function countUp(id) {
  fetch(`https://github.com/${site.repo}/releases/download/${site.tag}/c${id}.txt`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  try { sessionStorage.removeItem("cwok-counts"); } catch {}
}
document.addEventListener("click", (ev) => { const a = ev.target.closest?.("a[data-countup]"); if (a) countUp(a.dataset.countup); });
if (site.repo && document.querySelector("[data-count]")) loadCounts().then((c) => {
  if (!c) return;
  for (const n of document.querySelectorAll("[data-count]")) if (n.dataset.count in c) { n.textContent = c[n.dataset.count]; if (n.tagName === "TD") n.dataset.v = c[n.dataset.count]; }
});

// ---- 一覧：見出しを押して並べ替え・検索・タグで絞り込み ----
for (const table of document.querySelectorAll("table.list[data-sortable]")) {
  const body = table.tBodies[0], heads = [...table.tHead.rows[0].cells], wrap = table.closest(".tablewrap"), tools = wrap?.previousElementSibling;
  const q = tools?.querySelector(".q"), cnt = tools?.querySelector(".cnt");
  let sort = null;
  const val = (tr, i) => { const c = tr.cells[i]; return c.dataset.v ?? c.textContent; };
  function draw() {
    const word = (q?.value || "").trim().toLowerCase();
    let n = 0;
    for (const tr of body.rows) {
      const show = !word || (tr.textContent + " " + (tr.dataset.find || "")).toLowerCase().includes(word);
      tr.hidden = !show; if (show) n++;
    }
    if (cnt) cnt.textContent = `${n}件`;
    heads.forEach((th, i) => (th.dataset.dir = sort && sort.i === i ? (sort.dir > 0 ? "up" : "down") : ""));
  }
  heads.forEach((th, i) => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      sort = { i, dir: sort?.i === i ? -sort.dir : 1 };
      const num = i === 4 || i === 7;
      [...body.rows].sort((a, b) => (num ? Number(val(a, i)) - Number(val(b, i)) : String(val(a, i)).localeCompare(String(val(b, i)), "ja")) * sort.dir).forEach((tr) => body.append(tr));
      draw();
    });
  });
  q?.addEventListener("input", draw);
}

// ---- コードの枠：コピーのボタン ----
for (const pre of document.querySelectorAll("pre.code")) {
  const text = pre.textContent;
  const b = el("button", { type: "button", className: "btn small copycode" }, "コピー");
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = "コピーしました"; } catch { b.textContent = "コピーできませんでした"; }
    setTimeout(() => (b.textContent = "コピー"), 1500);
  });
  const wrap = el("div", { className: "codewrap" });
  pre.replaceWith(wrap);
  wrap.append(b, pre);
}

// ---- URL の欄：コピーのボタン ----
for (const box of document.querySelectorAll("input.copybox")) {
  const b = el("button", { type: "button", className: "btn small" }, "コピー");
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(box.value); b.textContent = "コピーしました"; } catch { box.select(); b.textContent = "選びました（Ctrl+C でコピー）"; }
    setTimeout(() => (b.textContent = "コピー"), 1500);
  });
  box.after(b);
}

// ---- DLキーつきの作品：キーを確かめて、元のファイルに戻して保存する（キーはどこにも送らない） ----
const keybox = document.getElementById("keybox");
if (keybox) {
  const it = JSON.parse(keybox.dataset.item);
  const say = (text, cls = "") => document.getElementById("msg").replaceChildren(...(text ? [el("div", { className: "msg " + cls }, text)] : []));
  const key = el("input", { type: "password", autocomplete: "off", placeholder: "DLキー" });
  const btn = el("button", { type: "button", className: "btn primary" }, "ダウンロード");
  async function go() {
    if (!key.value) return say("DLキーを入れてください。", "err");
    btn.disabled = true; say("ファイルを取得しています…");
    try {
      const r = await fetch(new URL(site.root + it.path, location.href));
      if (!r.ok) throw new Error("ファイルを取得できませんでした（" + r.status + "）");
      const enc = new Uint8Array(await r.arrayBuffer());
      say("DLキーを確かめています…");
      const plain = await decryptBytes(enc, key.value, it.iter || undefined);
      if (it.sha256 && (await sha256Hex(plain)) !== it.sha256) throw new Error("ファイルが壊れています。作者様にお知らせください。");
      const url = URL.createObjectURL(new Blob([plain], { type: "application/octet-stream" }));
      const a = el("a", { href: url, download: it.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      countUp(it.id);
      say("ダウンロードを始めました。", "ok");
    } catch (e) {
      say(e.message === "bad-key" ? "DLキーが違います。" : e.message === "bad-file" ? "ファイルの形が正しくありません。" : String(e.message || e), "err");
    } finally { btn.disabled = false; }
  }
  btn.addEventListener("click", go);
  key.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
  keybox.append(el("div", { className: "row" }, key, btn), el("p", { className: "note" }, "DLキーはこの画面の中だけで使い、どこにも送りません。"));
}
