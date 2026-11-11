import { h, fmtSize, fmtDate, ROOT } from "./common.js";
import { encryptBytes, sha256Hex, ENC_ITER } from "./enc.js";
import { renderWiki } from "./wiki.js";
import { DEFAULT_TEMPLATE } from "./template.js";

const MAX_FILE = 95 * 1024 * 1024, MAX_IMAGE = 5 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const view = $("view");
const say = (text, cls = "") => { $("msg").replaceChildren(text ? h("div", { class: "msg " + cls }, text) : ""); if (text) window.scrollTo(0, 0); };
const splitTags = (s) => [...new Set(String(s).split(/[、,\n]/).map((t) => t.trim()).filter(Boolean))];
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const newKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const VIS_NAME = { public: "公開", unlisted: "限定公開（URL を知っている人だけ）", private: "非公開（自分だけ）" };
const VIS_SHORT = { public: "公開", unlisted: "限定公開", private: "非公開" };
const VIS_ORDER = ["public", "unlisted", "private"];
const stricter = (a, b) => VIS_ORDER[Math.max(VIS_ORDER.indexOf(a), VIS_ORDER.indexOf(b))];
const R18_NOTE = "R18（成人向け）の作品・素材は、GitHub には置けません（GitHub の決まりのため。DLキーつき・限定公開・非公開でも同じです）。R15 も、あからさまな性的な描写や過度に残酷な描写のあるものは置けません。";
const COMPAT_OPT = [["", "形式に合わせる"], ["verified", "確認済み"], ["expected", "動くはず"], ["no", "非対応"], ["unknown", "未確認"]];

let repo = "", token = "", branch = "main", siteBase = "";
let D = null, P = null; // data/items.json・data/pages.json
const sha = { items: undefined, pages: undefined };
let tab = "boards", boardId = null;
let keepBulk = null; // まとめて追加で送れなかった作品（描き直したあとに欄へ戻す）

// ---- GitHub とのやりとり（api.github.com だけ） ----
async function gh(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || "GitHub からエラーが返りました"); e.status = r.status; throw e; }
  return j;
}
const b64utf8 = (s) => { const u = new TextEncoder().encode(s); let b = ""; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(b); };
const utf8b64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64bytes = (bytes) => new Promise((ok, ng) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(",")[1] || "");
  fr.onerror = () => ng(fr.error);
  fr.readAsDataURL(new Blob([bytes]));
});
async function readJson(path) {
  try { const j = await gh("GET", `/contents/${path}?ref=${encodeURIComponent(branch)}`); return { sha: j.sha, data: JSON.parse(utf8b64(j.content)) }; }
  catch (e) { if (e.status === 404) return { sha: undefined, data: null }; throw e; }
}
async function loadItems() {
  const r = await readJson("data/items.json");
  sha.items = r.sha; D = r.data || {};
  D.items ||= []; D.site ||= {}; D.next_id ||= 1;
  if (!D.boards?.length) D.boards = [{ id: 1, title: D.site.title || "シナリオ置き場", note: "", visibility: "public", key: newKey() }];
  D.next_board ||= Math.max(...D.boards.map((b) => b.id)) + 1;
  for (const it of D.items) it.board ??= D.boards[0].id;
}
async function loadPages() {
  const r = await readJson("data/pages.json");
  sha.pages = r.sha; P = r.data || {};
  P.pages ||= []; P.next_id ||= 1; P.menu ||= ""; P.template ||= ""; P.css ||= ""; P.home ??= null; P.design ||= {};
}
async function saveFile(which, message) {
  const path = which === "items" ? "data/items.json" : "data/pages.json";
  const j = await gh("PUT", `/contents/${path}`, { message, content: b64utf8(JSON.stringify(which === "items" ? D : P, null, 2) + "\n"), ...(sha[which] ? { sha: sha[which] } : {}), branch });
  sha[which] = j.content.sha;
}
// ファイルを「受け取り箱」（inbox ブランチ）に置く。公開の作業が Releases へ移して、箱を空にする
async function pushInbox(name, bytes) {
  const blob = await gh("POST", "/git/blobs", { content: await b64bytes(bytes), encoding: "base64" });
  for (let i = 0; ; i++) {
    try {
      let head = null;
      try { head = (await gh("GET", "/git/ref/heads/inbox")).object.sha; } catch (e) { if (e.status !== 404) throw e; }
      const base = head ? (await gh("GET", `/git/commits/${head}`)).tree.sha : undefined;
      const tree = await gh("POST", "/git/trees", { ...(base ? { base_tree: base } : {}), tree: [{ path: name, mode: "100644", type: "blob", sha: blob.sha }] });
      const commit = await gh("POST", "/git/commits", { message: "ファイルを受け取り箱に置く", tree: tree.sha, parents: head ? [head] : [] });
      if (head) await gh("PATCH", "/git/refs/heads/inbox", { sha: commit.sha });
      else await gh("POST", "/git/refs", { ref: "refs/heads/inbox", sha: commit.sha });
      return;
    } catch (e) { if (i >= 2 || ![404, 409, 422].includes(e.status)) throw e; } // 箱が空にされた直後などは、やり直す
  }
}

// 画像をリポジトリの media/ に置いて、ファイル名を返す
async function uploadImage(file) {
  if (file.size > MAX_IMAGE) throw new Error("画像が大きすぎます（5MBまで）。");
  const ext = (/\.(png|jpe?g|gif|webp)$/i.exec(file.name) || [".png"])[0].toLowerCase();
  const name = /^[\w.\-]+$/.test(file.name) ? file.name : `img-${Date.now()}${ext}`;
  let old; try { old = (await gh("GET", `/contents/media/${name}?ref=${encodeURIComponent(branch)}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
  await gh("PUT", `/contents/media/${name}`, { message: "画像を追加", content: await b64bytes(new Uint8Array(await file.arrayBuffer())), ...(old ? { sha: old } : {}), branch });
  return name;
}

// 操作の共通の流れ：ボタンを止める → 実行 → 画面を描き直す
async function run(fn, stepEl, redraw = true) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  $("msg").replaceChildren();
  try { await fn((t) => stepEl && (stepEl.textContent = t)); if (redraw) draw(); }
  catch (e) {
    say(e.status === 409 ? "ほかの場所で内容が変わっていました。ページを読み込み直してから、もう一度お試しください。"
      : e.status === 401 ? "キーが正しくないか、期限が切れています。"
      : e.status === 403 || e.status === 404 ? "このキーでは操作できませんでした。キーの「Contents」が「Read and write」になっているか、リポジトリ名が合っているかをお確かめください。（" + e.message + "）"
      : "できませんでした：" + (e.message || e), "err");
  } finally { document.querySelectorAll("button").forEach((b) => (b.disabled = false)); if (stepEl) stepEl.textContent = ""; }
}
const field = (label, input, note) => h("div", { class: "field" }, h("label", {}, label), input, note && h("div", { class: "note" }, note));
const select = (opts, value) => h("select", {}, opts.map(([v, name]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, name)));
const urlBox = (url) => h("div", { class: "row" }, h("input", { type: "text", class: "mono", readOnly: true, value: url, size: 56 }),
  h("button", { type: "button", class: "btn small", onclick: (ev) => { navigator.clipboard?.writeText(url); ev.target.textContent = "コピーしました"; setTimeout(() => (ev.target.textContent = "コピー"), 1500); } }, "コピー"));
function sureButton(label, fn) {
  const b = h("button", { type: "button", class: "btn small danger", onclick: () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "本当に削除する"; setTimeout(() => { b.dataset.sure = ""; b.textContent = label; }, 4000); return; }
    fn();
  } }, label);
  return b;
}
const boardOf = (id) => D.boards.find((b) => b.id === id);
const effVis = (it) => { const b = boardOf(it.board) || D.boards[0]; return !it.visibility || it.visibility === "inherit" ? b.visibility : stricter(b.visibility, it.visibility); };
const pathOf = (x, vis) => (vis === "unlisted" ? x.key : String(x.id));

// ---- タブ ----
const TABS = [["boards", "アップローダー"], ["pages", "ページ（HP）"], ["design", "デザイン"], ["site", "置き場の設定"]];
function draw() {
  $("tabs").replaceChildren(...TABS.map(([k, name]) => h("button", { type: "button", "aria-selected": String(tab === k), onclick: () => { tab = k; boardId = null; say(""); draw(); } }, name)));
  view.replaceChildren(...{ boards: boardId ? drawBoard : drawBoards, pages: drawPages, design: drawDesign, site: drawSite }[tab]().filter(Boolean));
}

// ---- アップローダーの一覧（自分にしか見えない管理画面） ----
function drawBoards() {
  const formBox = h("div", {});
  const openForm = (b) => {
    const title = h("input", { type: "text", maxLength: 80, value: b?.title || "" });
    const note = h("textarea", { maxLength: 2000 }, b?.note || "");
    const vis = select(Object.entries(VIS_NAME), b?.visibility || "public");
    formBox.replaceChildren(h("div", { class: "card" }, h("h2", {}, b ? "アップローダーの設定" : "新規アップローダー"),
      field("タイトル（必須）", title), field("説明", note),
      field("公開範囲", vis, "限定公開：一覧には出さず、URL を知っている人だけが見られます。企画用のファイル置き場などに。非公開：サイトには出しません。"),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", onclick: () => run(async () => {
        if (!title.value.trim()) throw new Error("タイトルを入れてください。");
        await loadItems();
        const cur = b ? boardOf(b.id) : null;
        if (b && !cur) throw new Error("このアップローダーは、もう削除されています。");
        const val = { title: title.value.trim(), note: note.value.trim(), visibility: vis.value };
        if (cur) Object.assign(cur, val); else D.boards.push({ id: D.next_board++, ...val, key: newKey() });
        await saveFile("items", cur ? "アップローダーの設定を更新" : "アップローダーを追加");
        say("保存しました。数分でサイトに反映されます。", "ok");
      }) }, "保存する"), h("button", { type: "button", class: "btn", onclick: () => formBox.replaceChildren() }, "やめる"))));
    formBox.scrollIntoView({ block: "start" });
  };
  const rows = D.boards.map((b) => {
    const list = D.items.filter((it) => it.board === b.id);
    const del = sureButton("削除", () => run(async () => {
      await loadItems();
      if (D.items.some((it) => it.board === b.id)) throw new Error("作品が残っています。先に作品を削除するか、ほかのアップローダーへ移してください。");
      if (D.boards.length <= 1) throw new Error("最後の1つは削除できません。");
      D.boards = D.boards.filter((x) => x.id !== b.id);
      await saveFile("items", "アップローダーを削除");
      say("削除しました。", "ok");
    }));
    return h("tr", {},
      h("td", {}, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); boardId = b.id; say(""); draw(); } }, b.title),
        b.visibility !== "private" && h("div", { class: "note mono" }, `${siteBase}u/${pathOf(b, b.visibility)}/`)),
      h("td", {}, VIS_SHORT[b.visibility] || "公開"),
      h("td", { class: "num" }, String(list.length)),
      h("td", { class: "num" }, fmtSize(list.reduce((s, it) => s + (it.file?.size || 0), 0))),
      h("td", { class: "num" }, h("button", { type: "button", class: "btn small primary", onclick: () => { boardId = b.id; say(""); draw(); } }, "管理画面"), " ",
        h("button", { type: "button", class: "btn small", onclick: () => openForm(b) }, "設定"), " ", del));
  });
  return [h("h1", {}, "アップローダー", h("small", {}, repo)),
    h("div", { class: "tablewrap" }, h("table", { class: "list" }, h("thead", {}, h("tr", {}, ["タイトル", "公開範囲", "作品数", "ディスク", ""].map((t) => h("th", {}, t)))), h("tbody", {}, rows))),
    h("div", { class: "tools" }, h("button", { type: "button", class: "btn primary", onclick: () => openForm(null) }, "＋新規アップローダー"),
      h("a", { class: "btn", href: `https://github.com/${repo}/actions`, target: "_blank", rel: "noopener" }, "公開の進み具合（GitHub）")),
    formBox];
}

// ---- 1つのアップローダーの管理画面（作品の追加・差し替え・編集・削除） ----
function drawBoard() {
  const b = boardOf(boardId);
  if (!b) { boardId = null; return drawBoards(); }
  const formBox = h("div", {});
  const openForm = (it) => {
    say("");
    const f = {
      title: h("input", { type: "text", maxLength: 120, value: it?.title || "" }),
      file: h("input", { type: "file" }),
      key: h("input", { type: "password", autocomplete: "new-password" }),
      unlock: h("input", { type: "checkbox" }),
      comment: h("textarea", { maxLength: 2000 }, it?.comment || ""),
      tags: h("input", { type: "text", value: (it?.tags || []).join("、") }),
      version: h("input", { type: "text", maxLength: 30, size: 10, value: it?.version || "" }),
      author: h("input", { type: "text", maxLength: 80, size: 18, value: it?.author || "" }),
      type: select([["scenario", "シナリオ"], ["skin", "スキン"], ["material", "素材"], ["other", "そのほか"]], it?.type || "scenario"),
      format: select([["classic", "クラシック（1.50）"], ["next", "Next仕様"], ["wsn", "Py仕様（WSN）"], ["none", "シナリオ以外"]], it?.format || "classic"),
      rating: select([["all", "全年齢"], ["r15", "R15"]], it?.rating === "r15" ? "r15" : "all"),
      convert: select([["self", "自己責任ならOK"], ["allowed", "自由"], ["forbidden", "しないでほしい"]], it?.convert || "self"),
      cw150: select(COMPAT_OPT, it?.compat?.cw150), next: select(COMPAT_OPT, it?.compat?.next), py: select(COMPAT_OPT, it?.compat?.py),
      vis: select([["inherit", `アップローダーに合わせる（今は「${VIS_SHORT[b.visibility]}」）`], ...Object.entries(VIS_NAME)], it?.visibility || "inherit"),
      board: select(D.boards.map((x) => [x.id, x.title]), it?.board ?? b.id),
      page: select([["", "（なし）"], ...P.pages.map((p) => [p.id, p.title])], it?.page ?? ""),
      share: h("input", { type: "checkbox", checked: it?.share === true }),
    };
    const step = h("span", { class: "note" });
    const locked = !!it?.file?.enc;
    const keyShow = h("input", { type: "checkbox", onchange: (ev) => (f.key.type = ev.target.checked ? "text" : "password") });
    const presets = h("div", { class: "tags" }, (D.site.tag_presets || []).map((t) => h("a", { class: "tag", href: "#", onclick: (ev) => {
      ev.preventDefault();
      const cur = splitTags(f.tags.value);
      f.tags.value = (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]).join("、");
    } }, t)));
    const submit = () => run(async (setStep) => {
      const title = f.title.value.trim(), file = f.file.files[0], key = f.key.value;
      if (!title) throw new Error("タイトルを入れてください。");
      if (!it && !file) throw new Error("ファイルを選んでください。");
      if (file && file.size > MAX_FILE) throw new Error("ファイルが大きすぎます（95MBまで）。");
      if (!file && key) throw new Error("DLキーを付ける・変えるときは、ファイルも選び直してください。");
      if (!file && f.unlock.checked) throw new Error("DLキーを外すときは、ファイルも選び直してください。");
      if (file && locked && !key && !f.unlock.checked) throw new Error("この作品には DLキーが付いています。新しいファイルにも DLキーを入れるか、「DLキーを外して…」にチェックを入れてください。");
      let push = null;
      if (file) {
        setStep("ファイルを読んでいます…");
        const plain = new Uint8Array(await file.arrayBuffer());
        const meta = { name: file.name.replace(/[\\/:*?"<>|\r\n\t]/g, "_"), size: plain.length, sha256: await sha256Hex(plain), rev: 0, enc: null };
        let body = plain;
        if (key) { setStep("DLキーで暗号化しています…"); body = await encryptBytes(plain, key); meta.enc = { v: 1, iter: ENC_ITER }; }
        if (body.length > MAX_FILE) throw new Error("ファイルが大きすぎます（95MBまで）。");
        push = { meta, body };
      }
      setStep("今の内容を確かめています…");
      await loadItems(); // ほかのタブでの変更を消さないように、直前の内容に足す
      const cur = it ? D.items.find((x) => x.id === it.id) : null;
      if (it && !cur) throw new Error("この作品は、もう削除されています。");
      const id = cur ? cur.id : D.next_id;
      let fileMeta = cur?.file || null;
      if (push) {
        push.meta.rev = (cur?.file?.rev || 0) + 1;
        setStep("ファイルを送っています…（大きいファイルは数分かかります）");
        await pushInbox(`f${id}.r${push.meta.rev}.bin`, push.body);
        fileMeta = push.meta;
      }
      const compat = {};
      for (const k of ["cw150", "next", "py"]) if (f[k].value) compat[k] = f[k].value;
      const now = nowIso();
      const val = {
        id, board: Number(f.board.value), visibility: f.vis.value, key: cur?.key || newKey(), share: f.share.checked,
        title, author: f.author.value.trim(), comment: f.comment.value.trim(), version: f.version.value.trim(),
        type: f.type.value, format: f.format.value, compat, rating: f.rating.value, convert: f.convert.value,
        tags: splitTags(f.tags.value), page: f.page.value ? Number(f.page.value) : null, file: fileMeta, created: cur?.created || now, updated: now,
      };
      if (cur) D.items[D.items.indexOf(cur)] = val; else { D.items.push(val); D.next_id = id + 1; }
      setStep("内容を保存しています…");
      await saveFile("items", cur ? "作品の情報を更新" : "作品を追加");
      say("保存しました。数分でサイトに反映されます。（「公開の進み具合」で確かめられます）", "ok");
    }, step);
    formBox.replaceChildren(h("div", { class: "card", id: "itemform" }, h("h2", {}, it ? "作品を編集する" : "新しい作品を追加する"),
      field("タイトル（必須）", f.title),
      field(it?.file ? "ファイルを差し替える（差し替えるときだけ選ぶ）" : "ファイル（必須）", h("div", {}, it?.file && h("div", { class: "note" }, `今のファイル：${it.file.name}（${fmtSize(it.file.size)}）`), f.file),
        "1ファイル95MBまで。ファイルを差し替えても、DLページの URL は変わりません。"),
      field("DLキー（付けるときだけ）", h("div", { class: "row" }, f.key, h("label", {}, keyShow, " 表示する")),
        (locked ? "今は DLキーが付いています。" : it?.file ? "今は DLキーが付いていません。" : "")
        + (it?.file ? "DLキーを付ける・変える・外すときは、ファイルを選び直してください（ファイルを暗号化し直すためです）。" : "")
        + "DLキーは保存されないので、忘れないように控えてください。短いキーは当てられやすいので、長めがおすすめです。"),
      locked && h("div", { class: "field" }, h("label", {}, f.unlock, " DLキーを外して、だれでもダウンロードできるようにする")),
      field("コメント", f.comment),
      field("タグ（「、」で区切る）", h("div", {}, f.tags, presets), "「R18」などのタグを付けても、R18 の作品は置けません。" + R18_NOTE),
      h("div", { class: "row" }, field("バージョン", f.version), field("作者名", f.author), field("種類", f.type), field("形式", f.format), field("対象年齢", f.rating), field("ほかの形式への変換", f.convert)),
      h("p", { class: "note r18note" }, "対象年齢：" + R18_NOTE),
      h("div", { class: "field" }, h("label", {}, "対応エンジン"), h("div", { class: "row" }, h("label", {}, "1.50 ", f.cw150), h("label", {}, "Next ", f.next), h("label", {}, "Py ", f.py)),
        h("div", { class: "note" }, "「形式に合わせる」のままなら、形式から自動で決めます（例：Next仕様 → 1.50 は非対応）。")),
      h("div", { class: "row" }, field("公開範囲", f.vis), field("アップローダー", f.board), field("紹介ページ", f.page)),
      h("div", { class: "field" }, h("label", {}, f.share, " CWカタログで共有する（この作品の情報を JSON 形式で公開する）"),
        h("div", { class: "note" }, "チェックを入れた作品だけ、DLページに CWカタログ用の URL が出て、置き場のカタログ（index.json）にも入ります（カタログに入るのは「公開」の作品だけです）。入れなければ、JSON はどこにも出しません。")),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", id: "save", onclick: submit }, "保存する"), h("button", { type: "button", class: "btn", onclick: () => formBox.replaceChildren() }, "やめる"), step)));
    formBox.scrollIntoView({ block: "start" });
  };
  // ---- まとめて追加：ファイルをいくつも選んで、1回で登録する ----
  const guess = (fileName) => {
    const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
    const m = /[\s_\-（(]*(?:ver|v)[._ ]?(\d+(?:[._]\d+)*)[）)]*\s*$/i.exec(base);
    return { title: (m ? base.slice(0, m.index) : base).trim() || base, version: m ? m[1].replace(/_/g, ".") : "" };
  };
  const openBulk = () => {
    if (!keepBulk) say("");
    let list = []; // { file, title, version, comment }
    const picker = h("input", { type: "file", multiple: true, id: "bulkfiles" });
    const tbody = h("tbody", {});
    const total = h("span", { class: "note" });
    const step = h("span", { class: "note" });
    const c = {
      tags: h("input", { type: "text" }), author: h("input", { type: "text", maxLength: 80, size: 18 }),
      type: select([["scenario", "シナリオ"], ["skin", "スキン"], ["material", "素材"], ["other", "そのほか"]], "scenario"),
      format: select([["classic", "クラシック（1.50）"], ["next", "Next仕様"], ["wsn", "Py仕様（WSN）"], ["none", "シナリオ以外"]], "classic"),
      rating: select([["all", "全年齢"], ["r15", "R15"]], "all"),
      convert: select([["self", "自己責任ならOK"], ["allowed", "自由"], ["forbidden", "しないでほしい"]], "self"),
      vis: select([["inherit", `アップローダーに合わせる（今は「${VIS_SHORT[b.visibility]}」）`], ...Object.entries(VIS_NAME)], "inherit"),
      share: h("input", { type: "checkbox" }),
    };
    const redraw = () => {
      tbody.replaceChildren(...list.map((r, i) => h("tr", {},
        h("td", {}, h("input", { type: "text", maxLength: 120, size: 24, value: r.title, oninput: (ev) => (r.title = ev.target.value) })),
        h("td", {}, h("input", { type: "text", maxLength: 30, size: 6, value: r.version, oninput: (ev) => (r.version = ev.target.value) })),
        h("td", {}, h("input", { type: "text", maxLength: 2000, size: 30, value: r.comment, oninput: (ev) => (r.comment = ev.target.value) })),
        h("td", {}, r.file.name, r.file.size > MAX_FILE && h("span", { class: "badge r" }, "大きすぎます")),
        h("td", { class: "num" }, fmtSize(r.file.size)),
        h("td", { class: "num" }, h("button", { type: "button", class: "btn small", onclick: () => { list.splice(i, 1); redraw(); } }, "外す")))));
      if (!list.length) tbody.append(h("tr", {}, h("td", { colSpan: 6, class: "note" }, "ファイルを選ぶと、ここに並びます。タイトルとバージョンは、ファイル名から入れます（直せます）。")));
      total.textContent = list.length ? `${list.length}作品・合計 ${fmtSize(list.reduce((n, r) => n + r.file.size, 0))}` : "";
    };
    const addFiles = (files) => {
      for (const file of files) if (!list.some((r) => r.file.name === file.name && r.file.size === file.size)) list.push({ file, ...guess(file.name), comment: "" });
      redraw();
    };
    picker.addEventListener("change", () => { addFiles([...picker.files]); picker.value = ""; });
    const submit = () => run(async (setStep) => {
      if (!list.length) throw new Error("ファイルを選んでください。");
      if (list.some((r) => !r.title.trim())) throw new Error("タイトルが空の作品があります。");
      if (list.some((r) => r.file.size > MAX_FILE)) throw new Error("大きすぎるファイルがあります（1ファイル95MBまで）。「外す」で外してください。");
      await loadItems();
      const startId = D.next_id, done = [], failed = [];
      for (let i = 0; i < list.length; i++) {
        const r = list[i], id = startId + done.length;
        try {
          setStep(`${i + 1}／${list.length}：${r.file.name} を送っています…`);
          const plain = new Uint8Array(await r.file.arrayBuffer());
          const meta = { name: r.file.name.replace(/[\\/:*?"<>|\r\n\t]/g, "_"), size: plain.length, sha256: await sha256Hex(plain), rev: 1, enc: null };
          await pushInbox(`f${id}.r1.bin`, plain);
          done.push({ r, id, meta });
        } catch (e) { failed.push({ r, why: e.message || String(e) }); }
      }
      if (done.length) {
        setStep("内容を保存しています…");
        await loadItems(); // ほかのタブでの変更を消さないように、直前の内容に足す
        if (D.next_id !== startId) throw new Error("送っているあいだに、ほかの場所で作品が増えました。お手数ですが、もう一度「まとめて登録する」を押してください。");
        const now = nowIso();
        for (const { r, id, meta } of done) D.items.push({
          id, board: b.id, visibility: c.vis.value, key: newKey(), share: c.share.checked,
          title: r.title.trim(), author: c.author.value.trim(), comment: r.comment.trim(), version: r.version.trim(),
          type: c.type.value, format: c.format.value, compat: {}, rating: c.rating.value, convert: c.convert.value,
          tags: splitTags(c.tags.value), page: null, file: meta, created: now, updated: now,
        });
        D.next_id = startId + done.length;
        await saveFile("items", `作品を${done.length}件追加`);
      }
      if (failed.length) {
        // 送れなかった作品と、共通の設定を、描き直したあとの欄へ戻す
        keepBulk = { list: failed.map((f) => f.r), common: Object.fromEntries(Object.entries(c).map(([k, el]) => [k, el.type === "checkbox" ? el.checked : el.value])) };
        say(`${done.length}作品を登録しました。次の${failed.length}作品は送れませんでした（欄に残しています。もう一度お試しください）：\n` + failed.map((f) => `・${f.r.file.name}（${f.why}）`).join("\n"), "err");
      } else say(`${done.length}作品を登録しました。数分でサイトに反映されます。`, "ok");
    }, step);
    formBox.replaceChildren(h("div", { class: "card", id: "bulkform",
      ondragover: (ev) => ev.preventDefault(),
      ondrop: (ev) => { ev.preventDefault(); addFiles([...(ev.dataTransfer?.files || [])]); } },
      h("h2", {}, "まとめて追加する"),
      h("p", { class: "note" }, "ファイルをいくつも選ぶか、この枠の中にドロップしてください。1ファイル95MBまで。DLキーつきの作品と、作品ごとの対応エンジン・紹介ページは、登録したあとに「編集」から設定してください。"),
      h("div", { class: "row" }, picker, total),
      h("div", { class: "tablewrap" }, h("table", { class: "list" }, h("thead", {}, h("tr", {}, ["タイトル（必須）", "バージョン", "コメント", "ファイル名", "容量", ""].map((t) => h("th", {}, t)))), tbody)),
      h("h3", {}, "全部の作品に共通の設定"),
      field("タグ（「、」で区切る）", c.tags, R18_NOTE),
      h("div", { class: "row" }, field("作者名", c.author), field("種類", c.type), field("形式", c.format), field("対象年齢", c.rating), field("ほかの形式への変換", c.convert), field("公開範囲", c.vis)),
      h("div", { class: "field" }, h("label", {}, c.share, " CWカタログで共有する（JSON 形式で公開する）")),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", id: "bulksave", onclick: submit }, "まとめて登録する"), h("button", { type: "button", class: "btn", onclick: () => formBox.replaceChildren() }, "やめる"), step)));
    if (keepBulk) {
      list = keepBulk.list;
      for (const [k, v] of Object.entries(keepBulk.common)) { if (c[k].type === "checkbox") c[k].checked = v; else c[k].value = v; }
      keepBulk = null;
    }
    redraw();
    if (!$("msg").textContent) formBox.scrollIntoView({ block: "start" });
  };
  const rows = D.items.filter((it) => it.board === b.id).map((it) => {
    const vis = effVis(it);
    const del = sureButton("削除", () => run(async () => {
      await loadItems();
      D.items = D.items.filter((x) => x.id !== it.id);
      await saveFile("items", "作品を削除");
      say("削除しました。数分でサイトから消えます。", "ok");
    }));
    return h("tr", {},
      h("td", {}, it.title, it.file?.enc && h("span", { class: "badge key" }, "鍵"), it.share && h("span", { class: "badge" }, "カタログ共有"),
        vis !== "private" && h("div", { class: "note mono" }, `${siteBase}d/${pathOf(it, vis)}/`)),
      h("td", {}, it.file?.name || "—"),
      h("td", {}, VIS_SHORT[vis]),
      h("td", { class: "num" }, it.file ? fmtSize(it.file.size) : ""),
      h("td", { class: "date" }, fmtDate(it.updated || it.created)),
      h("td", { class: "num" }, h("button", { type: "button", class: "btn small", onclick: () => openForm(it) }, "編集"), " ", del));
  });
  if (!rows.length) rows.push(h("tr", {}, h("td", { colSpan: 6, class: "note" }, "まだ作品がありません。「＋新しい作品を追加」から始めてください。")));
  return [h("p", {}, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); boardId = null; draw(); } }, "← アップローダーの一覧へ")),
    h("h1", {}, b.title, h("small", {}, VIS_SHORT[b.visibility])),
    h("div", { class: "tools" }, h("button", { type: "button", class: "btn primary", id: "add", onclick: () => openForm(null) }, "＋新しい作品を追加"),
      h("button", { type: "button", class: "btn", id: "bulk", onclick: openBulk }, "＋まとめて追加")),
    h("div", { class: "tablewrap" }, h("table", { class: "list" }, h("thead", {}, h("tr", {}, ["タイトル", "ファイル名", "公開範囲", "容量", "更新日時", ""].map((t) => h("th", {}, t)))), h("tbody", { id: "rows" }, rows))),
    formBox, keepBulk && (queueMicrotask(openBulk), null)].filter(Boolean);
}

// ---- ページ（HP）：Wiki記法で書く ----
const previewCtx = () => ({
  pageHref: (name) => (P.pages.some((p) => p.title === name && p.visibility !== "private") ? "#" : null),
  mediaHref: (name) => (/^[\w.\-]+$/.test(name) ? `https://raw.githubusercontent.com/${repo}/${branch}/media/${name}` : null),
  dlLink: (id) => (D.items.some((x) => x.id === id) ? { href: "#" } : null),
  embed(name, arg) {
    const box = (t) => `<div class="card note">［${t}］（公開されたページでは、ここに本物が入ります）</div>`;
    if (name === "dl") { const it = D.items.find((x) => x.id === Number(arg)); return box(it ? `DLカード：${it.title.replace(/[&<>]/g, "")}` : "DLカード：作品が見つかりません"); }
    if (name === "dllist") { const b = arg ? boardOf(Number(arg)) : null; return box(arg ? (b ? `作品の一覧：${b.title.replace(/[&<>]/g, "")}` : "作品の一覧：アップローダーが見つかりません") : "公開している全作品の一覧"); }
    if (name === "pagelist") return box("ページの一覧");
    if (name === "uploaders") return box("アップローダーの一覧");
    if (name === "recent") return box("最近の更新");
    return null;
  },
});
// 記法の入力を助けるボタン（選んだ文字を囲む・行の頭に付ける・決まった形を入れる）
function editor(value) {
  const ta = h("textarea", {}, value || "");
  const wrap = (a, b, sample) => () => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || sample; ta.setRangeText(a + sel + b, s, e, "select"); ta.focus(); };
  const prefix = (p) => () => {
    const s = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1, e = ta.selectionEnd;
    ta.setRangeText(ta.value.slice(s, e).split("\n").map((l) => p + l).join("\n"), s, e, "select"); ta.focus();
  };
  const insert = (text) => () => { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); };
  const btn = (label, title, fn, style) => h("button", { type: "button", title, onclick: fn, style }, label);
  const imgFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, onchange: () => {
    const file = imgFile.files[0];
    if (file) run(async () => {
      const name = await uploadImage(file);
      ta.setRangeText(`&ref(${name})`, ta.selectionStart, ta.selectionEnd, "end");
      say("画像を置きました。本文に &ref(…) を入れました（プレビューに出るまで少し時間がかかることがあります）。", "ok");
      imgFile.value = "";
    }, null, false);
  } });
  const embed = select([["", "作品を埋め込む…"], ["#dllist()", "公開している全作品の一覧"], ["#uploaders()", "アップローダーの一覧"], ["#pagelist()", "ページの一覧"], ["#recent(5)", "最近の更新"],
    ...D.boards.map((b) => [`#dllist(${b.id})`, `一覧：${b.title}`]), ...D.items.map((it) => [`#dl(${it.id})`, `DLカード：${it.title}`]),
    ...D.items.map((it) => [`&dl(${it.id}){`, `押すとDLできる画像・文字：${it.title}`]), ...D.items.map((it) => [`&dlpage(${it.id}){`, `押すとDLページへ進む画像・文字：${it.title}`])], "");
  embed.addEventListener("change", () => {
    const v = embed.value;
    embed.value = "";
    if (!v) return;
    // &dl(番号){…}：選んでいる文字（&ref(画像) など）を囲む。何も選んでいなければ、見本を入れる
    if (v.startsWith("&")) wrap(v, "}", "ここに文字か &ref(画像)")(); else insert(`\n${v}\n`)();
  });
  const bar = h("div", { class: "toolbar" },
    btn("B", "太字", wrap("''", "''", "太字"), "font-weight:700"), btn("I", "斜体", wrap("'''", "'''", "斜体"), "font-style:italic"),
    btn("U", "下線", wrap("%%%", "%%%", "下線"), "text-decoration:underline"), btn("S", "取り消し線", wrap("%%", "%%", "取り消し"), "text-decoration:line-through"),
    btn("大", "見出し（大）", prefix("*")), btn("中", "見出し（中）", prefix("**")), btn("小", "見出し（小）", prefix("***")),
    btn("・", "箇条書き", prefix("-")), btn("1.", "番号つきリスト", prefix("+")), btn("＞", "引用", prefix(">")),
    btn("表", "表", insert("\n|~見出し1|見出し2|\n|内容1|内容2|\n")), btn("―", "水平線", insert("\n----\n")),
    btn("リンク", "リンク", wrap("[[", ">https://]]", "文字")), btn("画像", "画像を置いて入れる", () => imgFile.click()),
    btn("色", "文字の色", wrap("&color(red){", "}", "文字")), btn("サイズ", "文字の大きさ", wrap("&size(20){", "}", "文字")), btn("中央", "中央に寄せる", wrap("&align(center){", "}", "文字")),
    btn("たたむ", "折りたたみ", wrap("\n[+]見出し\n", "\n[END]\n", "中身")), btn("コード", "コードの枠（コピーのボタンつき）", wrap("\n=|CODE|\n", "\n||=\n", "ここに書いた文字が、そのまま出ます")), btn("目次", "目次", insert("\n#contents\n")), embed, imgFile);
  return { ta, bar };
}
let pageEdit = null; // { id | "new" | "menu" }
function drawPages() {
  if (pageEdit) return drawPageEditor();
  const rows = P.pages.map((p) => h("tr", {},
    h("td", {}, p.title, P.home === p.id && h("span", { class: "badge" }, "トップ"), p.visibility !== "private" && h("div", { class: "note mono" }, `${siteBase}p/${pathOf(p, p.visibility)}/`)),
    h("td", {}, VIS_SHORT[p.visibility] || "公開"),
    h("td", { class: "date" }, fmtDate(p.updated || p.created)),
    h("td", { class: "num" }, h("button", { type: "button", class: "btn small", onclick: () => { pageEdit = { id: p.id }; say(""); draw(); } }, "編集"), " ",
      sureButton("削除", () => run(async () => {
        await loadPages();
        P.pages = P.pages.filter((x) => x.id !== p.id);
        if (P.home === p.id) P.home = null;
        await saveFile("pages", "ページを削除");
        say("削除しました。", "ok");
      })))));
  if (!rows.length) rows.push(h("tr", {}, h("td", { colSpan: 4, class: "note" }, "まだページがありません。作品の紹介ページや、トップページをここで作れます。")));
  return [h("h1", {}, "ページ（HP）"),
    h("div", { class: "tools" }, h("button", { type: "button", class: "btn primary", id: "newpage", onclick: () => { pageEdit = { id: "new" }; say(""); draw(); } }, "＋新規ページ"),
      h("button", { type: "button", class: "btn", onclick: () => { pageEdit = { id: "menu" }; say(""); draw(); } }, "メニュー（横の欄）を編集")),
    h("div", { class: "tablewrap" }, h("table", { class: "list" }, h("thead", {}, h("tr", {}, ["タイトル", "公開範囲", "更新日時", ""].map((t) => h("th", {}, t)))), h("tbody", {}, rows))),
    h("p", { class: "note" }, "トップにするページを決めると、サイトのいちばん上のページがそのページになります（決めないときは、アップローダーの一覧が出ます）。")];
}
function drawPageEditor() {
  const isMenu = pageEdit.id === "menu";
  const p = typeof pageEdit.id === "number" ? P.pages.find((x) => x.id === pageEdit.id) : null;
  const title = h("input", { type: "text", maxLength: 120, value: p?.title || "" });
  const { ta, bar } = editor(isMenu ? P.menu : p?.body || "");
  const tags = h("input", { type: "text", value: (p?.tags || []).join("、") });
  const vis = select(Object.entries(VIS_NAME), p?.visibility || "public");
  const home = h("input", { type: "checkbox", checked: !!p && P.home === p.id });
  const preview = h("div", { class: "preview wikibody", hidden: true });
  const editBox = h("div", {}, bar, ta);
  const mode = (showPreview) => { preview.hidden = !showPreview; editBox.hidden = showPreview; if (showPreview) preview.innerHTML = renderWiki(ta.value, previewCtx()); };
  const back = () => { pageEdit = null; draw(); };
  const save = () => run(async () => {
    const body = ta.value;
    if (!isMenu && !title.value.trim()) throw new Error("タイトルを入れてください。");
    await loadPages();
    if (isMenu) { P.menu = body; await saveFile("pages", "メニューを更新"); }
    else {
      const cur = p ? P.pages.find((x) => x.id === p.id) : null;
      if (p && !cur) throw new Error("このページは、もう削除されています。");
      if (P.pages.some((x) => x.title === title.value.trim() && x.id !== cur?.id)) throw new Error("同じタイトルのページがあります。");
      const now = nowIso(), id = cur ? cur.id : P.next_id++;
      const val = { id, title: title.value.trim(), body, tags: splitTags(tags.value), visibility: vis.value, key: cur?.key || newKey(), created: cur?.created || now, updated: now };
      if (cur) P.pages[P.pages.indexOf(cur)] = val; else P.pages.push(val);
      if (home.checked) P.home = id; else if (P.home === id) P.home = null;
      await saveFile("pages", cur ? "ページを更新" : "ページを追加");
    }
    pageEdit = null;
    say("保存しました。数分でサイトに反映されます。", "ok");
  });
  return [h("p", {}, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); back(); } }, "← ページの一覧へ")),
    h("h1", {}, isMenu ? "メニュー（横の欄）" : p ? "ページを編集する" : "新規ページ"),
    isMenu ? h("p", { class: "note" }, "すべてのページの横に出る欄です。空にすると、欄そのものが出ません。") : field("タイトル（必須）", title, "ほかのページからは [[タイトル]] でリンクできます。"),
    h("div", { class: "tools" }, h("button", { type: "button", class: "btn", onclick: () => mode(false) }, "編集"), h("button", { type: "button", class: "btn", id: "pv", onclick: () => mode(true) }, "プレビュー"),
      h("a", { href: `https://github.com/${repo}/blob/${branch}/docs/Wiki記法.md`, target: "_blank", rel: "noopener" }, "使い方（Wiki記法）")),
    editBox, preview,
    !isMenu && field("タグ（任意。「、」で区切る）", tags),
    !isMenu && h("div", { class: "row" }, field("公開範囲", vis), h("div", { class: "field" }, h("label", {}, home, " このページをトップページにする"))),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn primary", id: "pagesave", onclick: save }, "保存"), h("button", { type: "button", class: "btn", onclick: back }, "やめる"))];
}

// ---- デザイン（テンプレート・CSS） ----
function drawDesign() {
  const tpl = h("textarea", { class: "code", placeholder: "空のときは、初期のテンプレートを使います。" }, P.template || "");
  const css = h("textarea", { class: "code", placeholder: "例：.bar { background:#eef; }" }, P.css || "");
  const vars = [["<%head%>", "必須。文字コード・タイトル・CSS などを入れる（<head> の中に書く）"], ["<%content%>", "必須。ページの本文"], ["<%menu%>", "メニュー（横の欄）"], ["<%nav%>", "上の帯のリンク（トップ・アップローダー・ページ一覧）"],
    ["<%site_title%>", "置き場の名前"], ["<%site_author%>", "作者名"], ["<%site_url%>", "作者様のサイト"], ["<%site_note%>", "置き場の説明"], ["<%page_title%>", "今のページのタイトル"], ["<%root%>", "サイトのいちばん上への道（リンクや画像の頭に付ける）"], ["<%updated%>", "サイトを公開した日時"], ["<%footer_text%>", "フッターの文（空なら置き場の名前）"],
    ["<!--menu_area-->…<!--/menu_area-->", "メニューがあるときだけ出す"], ["<!--index_area-->…<!--/index_area-->", "トップページだけに出す"], ["<!--not_index_area-->…<!--/not_index_area-->", "トップページ以外に出す"]];
  const d = P.design || {};
  const colorField = (key, label) => {
    const text = h("input", { type: "text", size: 10, maxLength: 20, placeholder: "指定なし", value: d[key] || "" });
    const sw = h("input", { type: "color", class: "swatch", value: /^#[0-9a-fA-F]{6}$/.test(d[key] || "") ? d[key] : "#ffffff", oninput: () => (text.value = sw.value) });
    text.dataset.key = key;
    return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "row" }, sw, text, h("button", { type: "button", class: "btn small", onclick: () => (text.value = "") }, "指定なし")));
  };
  const imageField = (key, label) => {
    const text = h("input", { type: "text", maxLength: 300, placeholder: "指定なし（置いた画像の名前か、https の URL）", value: d[key] || "" });
    text.dataset.key = key;
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, onchange: () => {
      if (file.files[0]) run(async () => { text.value = await uploadImage(file.files[0]); file.value = ""; say("画像を置きました。「デザインを保存する」で反映されます。", "ok"); }, null, false);
    } });
    return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "row" }, text, h("button", { type: "button", class: "btn small", onclick: () => file.click() }, "画像を置く"), file));
  };
  const menuPos = select([["right", "右"], ["left", "左"], ["top", "上（横に並べる）"], ["drawer", "右上のボタン（☰）で開く"]], d.menu_pos || "right");
  const imgMode = select([["repeat", "並べて敷きつめる"], ["cover", "1枚を広げる"], ["fixed", "1枚を広げて、スクロールしても動かさない"]], d.page_img_mode || "repeat");
  const menuSticky = h("input", { type: "checkbox", checked: !!d.menu_sticky }), headerSticky = h("input", { type: "checkbox", checked: !!d.header_sticky });
  const footerText = h("input", { type: "text", maxLength: 300, placeholder: "空なら、置き場の名前", value: d.footer_text || "" });
  const easy = h("div", { class: "card", id: "easy" }, h("h2", {}, "かんたん設定"),
    h("h3", {}, "ヘッダー（上の帯）"), h("div", { class: "row" }, colorField("header_bg", "背景の色"), colorField("header_fg", "文字の色")), imageField("header_img", "背景の画像"),
    h("div", { class: "field" }, h("label", {}, headerSticky, " スクロールしても上に固定する")),
    h("h3", {}, "ページ全体"), h("div", { class: "row" }, colorField("page_bg", "背景の色"), colorField("body_bg", "本文のところの背景の色"), colorField("text", "文字の色"), colorField("link", "リンクの色")),
    imageField("page_img", "背景の画像"), field("背景の画像の置き方", imgMode),
    h("h3", {}, "メニュー"), h("div", { class: "row" }, field("位置", menuPos), colorField("menu_bg", "背景の色")),
    h("div", { class: "field" }, h("label", {}, menuSticky, " スクロールしてもついてくるように固定する（位置が右・左のとき）")),
    h("h3", {}, "フッター（下の帯）"), h("div", { class: "row" }, colorField("footer_bg", "背景の色"), colorField("footer_fg", "文字の色")), imageField("footer_img", "背景の画像"), field("フッターの文", footerText),
    h("p", { class: "note" }, "メニューの中身は「ページ（HP）」→「メニュー（横の欄）を編集」で書きます（リンクを押すと、そのページへ進みます）。管理ページへのリンクは、フッターに小さく出ます。"));
  const readDesign = () => {
    const out = { menu_pos: menuPos.value, page_img_mode: imgMode.value, menu_sticky: menuSticky.checked, header_sticky: headerSticky.checked, footer_text: footerText.value.trim() };
    for (const el of easy.querySelectorAll("input[data-key]")) {
      const v = el.value.trim(), isImg = el.dataset.key.endsWith("_img");
      if (v && !(isImg ? /^([\w.\-]+|https:\/\/[^\s"'()\\]+)$/ : /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/).test(v)) throw new Error(isImg ? `画像は、置いた画像の名前か https の URL で書いてください：${v}` : `色は #ffffff のような形か、red のような色の名前で書いてください：${v}`);
      if (v) out[el.dataset.key] = v;
    }
    return out;
  };
  return [h("h1", {}, "デザイン"), easy,
    h("h2", {}, "くわしい設定（テンプレート・CSS）"),
    h("p", { class: "note" }, "サイトの枠（テンプレート）と、見た目（CSS）を自由に変えられます。テンプレートは HTML で書き、<%変数%> のところに中身が入ります。"),
    field("テンプレート（HTML）", tpl), h("div", { class: "tools" }, h("button", { type: "button", class: "btn", onclick: () => (tpl.value = DEFAULT_TEMPLATE) }, "初期のテンプレートを入れる"), h("button", { type: "button", class: "btn", onclick: () => (tpl.value = "") }, "空にする（初期に戻す）")),
    field("追加の CSS", css),
    h("button", { type: "button", class: "btn primary", onclick: () => run(async () => {
      const t = tpl.value, c = css.value, design = readDesign();
      if (t.trim() && (!t.includes("<%head%>") || !t.includes("<%content%>"))) throw new Error("テンプレートには <%head%> と <%content%> が必要です。");
      await loadPages();
      P.template = t; P.css = c; P.design = design;
      await saveFile("pages", "デザインを更新");
      say("保存しました。数分でサイトに反映されます。", "ok");
    }) }, "デザインを保存する"),
    h("h2", {}, "使える変数"), h("table", { class: "help" }, h("tbody", {}, vars.map(([k, v]) => h("tr", {}, h("th", { class: "mono" }, k), h("td", {}, v)))))];
}

// ---- 置き場の設定 ----
function drawSite() {
  const s = D.site;
  const f = { title: h("input", { type: "text", maxLength: 80, value: s.title || "" }), author: h("input", { type: "text", maxLength: 80, value: s.author || "" }),
    url: h("input", { type: "url", maxLength: 500, value: s.url || "" }), note: h("textarea", { maxLength: 2000 }, s.note || ""), presets: h("input", { type: "text", value: (s.tag_presets || []).join("、") }) };
  return [h("h1", {}, "置き場の設定"),
    field("置き場の名前", f.title), field("作者名（作品に書かなかったときに使う名前）", f.author), field("作者様のサイト", f.url),
    field("トップに出す説明", f.note, "トップにするページを決めているときは、出ません。"), field("よく使うタグ（「、」で区切る）", f.presets),
    h("button", { type: "button", class: "btn primary", onclick: () => run(async () => {
      const val = { title: f.title.value.trim(), author: f.author.value.trim(), url: f.url.value.trim(), note: f.note.value.trim(), tag_presets: splitTags(f.presets.value) };
      await loadItems();
      D.site = val;
      await saveFile("items", "置き場の設定を更新");
      say("設定を保存しました。数分でサイトに反映されます。", "ok");
    }) }, "設定を保存する")];
}

// ---- 入口 ----
async function enter() {
  repo = $("repo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
  token = $("token").value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return say("リポジトリとキーを入れてください。", "err");
  $("enter").disabled = true;
  try {
    branch = (await gh("GET", "")).default_branch || "main";
    await loadItems(); await loadPages();
    if ($("remember").checked) sessionStorage.setItem("cwok-admin", JSON.stringify({ repo, token }));
    const [o, r] = repo.split("/");
    siteBase = /\.github\.io$/.test(location.hostname) || location.protocol === "http:" ? ROOT.href : `https://${o.toLowerCase()}.github.io/${r}/`;
    $("login").hidden = true; $("app").hidden = false; $("logout").hidden = false;
    say(""); draw();
  } catch (e) {
    say(e.status === 401 ? "キーが正しくないか、期限が切れています。" : "開けませんでした。リポジトリ名とキーをお確かめください。（" + (e.message || e) + "）", "err");
  } finally { $("enter").disabled = false; }
}
$("enter").addEventListener("click", enter);
// キーを作る画面を、名前・持ち主・権限・期限が入った状態で開く（リポジトリだけは GitHub の決まりで入れられない）
function tokenUrl() {
  const owner = ($("repo").value.trim().split("/")[0] || "").replace(/[^\w.-]/g, "");
  const q = new URLSearchParams({ name: "シナリオ置き場の管理", description: `シナリオ置き場（${$("repo").value.trim() || "自分の置き場"}）の管理ページで使うキー`, expires_in: "366", contents: "write" });
  if (owner) q.set("target_name", owner);
  return "https://github.com/settings/personal-access-tokens/new?" + q;
}
$("repo").addEventListener("input", () => ($("tokenlink").href = tokenUrl()));
$("logout").addEventListener("click", (ev) => { ev.preventDefault(); sessionStorage.removeItem("cwok-admin"); location.reload(); });

// リポジトリ名は、公開済みのデータか、ページの住所（○○.github.io/△△/）から入れておく
try { $("repo").value = (await (await fetch(new URL("site.json", ROOT), { cache: "no-cache" })).json()).repo || ""; } catch {}
if (!$("repo").value || $("repo").value === "owner/repo") {
  const m = /^([\w-]+)\.github\.io$/.exec(location.hostname), seg = location.pathname.split("/")[1];
  $("repo").value = m && seg && seg !== "admin" ? `${m[1]}/${seg}` : "";
}
$("tokenlink").href = tokenUrl();
try {
  const s = JSON.parse(sessionStorage.getItem("cwok-admin") || "null");
  if (s) { $("repo").value = s.repo; $("token").value = s.token; $("remember").checked = true; enter(); }
} catch {}
