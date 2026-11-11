// 公開するサイト（_site）を組み立てる。部品は使わない（Node だけで動く）
//   node scripts/build.mjs --repo owner/repo --release _release.json --inbox _inbox --out _site --plan _plan.json
// ページはすべて、ここで出来上がった HTML として書き出す（スクリプトを動かさない道具からも読めるように）。
// ファイルの本体は Releases（タグ files）にあり、ここでは「何を置く・取得する・消すか」の予定（plan）を作る。
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderWiki, esc } from "../assets/wiki.js";
import { DEFAULT_TEMPLATE } from "../assets/template.js";
export { DEFAULT_TEMPLATE };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MAX_FILE = 95 * 1024 * 1024; // Pages は1ファイル100MBまで
export const assetName = (id, rev) => `f${id}.r${rev}.bin`;
export const counterName = (id) => `c${id}.txt`;
const FORMATS = ["classic", "next", "wsn", "none"];
const TYPES = ["scenario", "skin", "variant", "mod", "material", "resource", "other"];
const RATINGS = ["all", "r15", "r18"];
const CONVERTS = ["allowed", "self", "forbidden"];
const COMPAT = ["verified", "expected", "no", "unknown"];
const VIS = ["public", "unlisted", "private"];
const COMPAT_NAME = { verified: "確認済み", expected: "動くはず", no: "非対応", unknown: "未確認" };
const ENGINE_NAME = { cw150: "1.50", next: "Next", py: "Py" };
const FORMAT_NAME = { classic: "クラシック（1.50）", next: "Next仕様", wsn: "Py仕様（WSN）", none: "シナリオ以外" };
const RATING_NAME = { all: "", r15: "R15", r18: "R18" };

const str = (v, max) => (typeof v === "string" ? v : "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const httpUrl = (v) => (/^https?:\/\//i.test(v || "") ? String(v).slice(0, 500) : "");
const keyOf = (v) => (/^[a-z0-9]{12,40}$/.test(v || "") ? v : "");
const stricter = (a, b) => VIS[Math.max(VIS.indexOf(a), VIS.indexOf(b))];
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
// ファイル名：フォルダの区切り・危ない名前は受け付けない
export function safeFileName(name) {
  const n = str(name, 200).replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim();
  return !n || n === "." || n === ".." ? "" : n;
}
const compatOf = (f) => ({
  classic: { cw150: "expected", next: "expected", py: "expected" },
  next: { cw150: "no", next: "expected", py: "unknown" },
  wsn: { cw150: "no", next: "no", py: "expected" },
  none: { cw150: "unknown", next: "unknown", py: "unknown" },
}[f]);
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
// 日時は日本時間で書く
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000), p = (x) => String(x).padStart(2, "0");
  return `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
};

// デザインのかんたん設定 → CSS（色は色の形だけ、画像は置いた画像の名前か https の URL だけを通す）
export function designCss(d = {}) {
  const color = (v) => (/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(v || "") ? v : "");
  const image = (v) => (/^[\w.\-]+$/.test(v || "") ? `url("../media/${v}")` : /^https:\/\/[^\s"'()\\]+$/.test(v || "") ? `url("${v}")` : "");
  const rule = (sel, decl) => { const body = decl.filter(Boolean).join(""); return body ? `${sel}{${body}}\n` : ""; };
  const c = (prop, v) => (color(v) ? `${prop}:${color(v)};` : "");
  const bg = (v, mode) => (image(v) ? `background-image:${image(v)};` + ({ cover: "background-size:cover;background-position:center;background-repeat:no-repeat;", fixed: "background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;" }[mode] || "background-repeat:repeat;") : "");
  let css = rule(":root", [c("--fg", d.text), c("--link", d.link)])
    + rule("body", [c("background-color", d.page_bg), bg(d.page_img, d.page_img_mode)])
    + rule(".bar", [c("background-color", d.header_bg), bg(d.header_img, "cover"), d.header_sticky ? "position:sticky;top:0;z-index:20;" : ""])
    + rule(".bar .brand,.bar a.nav", [c("color", d.header_fg)])
    + rule(".foot", [c("background-color", d.footer_bg), c("color", d.footer_fg), bg(d.footer_img, "cover")])
    + rule(".wrap>main", [c("background-color", d.body_bg), color(d.body_bg) ? "padding-left:20px;padding-right:20px;" : ""])
    + rule(".side", [c("background-color", d.menu_bg), color(d.menu_bg) ? "padding:8px 12px;" : ""]);
  const pos = d.menu_pos;
  if (pos === "left") css += ".wrap{flex-direction:row-reverse}\n";
  if (pos === "top") css += ".wrap{flex-direction:column-reverse;gap:0}.side{width:100%;padding-top:10px}.side ul,.side ol{display:flex;flex-wrap:wrap;gap:4px 20px;list-style:none;padding:0}.side h2,.side h3,.side h4{display:none}\n";
  if (pos === "drawer") css += ".menu-btn{display:flex}.side{position:fixed;top:0;right:0;bottom:0;width:min(300px,85vw);margin:0;padding:64px 20px 20px;background:var(--bg);box-shadow:-4px 0 16px rgba(0,0,0,.2);overflow-y:auto;transform:translateX(105%);transition:transform .2s;z-index:30}.menu-toggle:checked~.side{transform:none}\n";
  if (d.menu_sticky && pos !== "drawer" && pos !== "top") css += ".side{position:sticky;top:" + (d.header_sticky ? "62px" : "12px") + ";max-height:calc(100vh - 24px);overflow-y:auto}\n";
  return css;
}

// テンプレート：<%変数%> と <!--ブロック名-->…<!--/ブロック名-->（条件に合うときだけ出す）
export function applyTemplate(tpl, vars, flags) {
  let s = tpl;
  for (const [name, on] of Object.entries(flags)) {
    const re = new RegExp(`<!--${name}-->([\\s\\S]*?)<!--/${name}-->`, "g");
    s = s.replace(re, on ? "$1" : "");
  }
  return s.replace(/<%(\w+)%>/g, (m, k) => (k in vars ? vars[k] : ""));
}

export function build({ data, pagesData = {}, release, inboxFiles = [], repo, commit = "", now = new Date() }) {
  const [owner, repoName] = String(repo).split("/");
  const base = `https://${owner.toLowerCase()}.github.io/${repoName}/`;
  const assets = new Map((release?.assets || []).map((a) => [a.name, a]));
  const inbox = new Set(inboxFiles);
  const generated = now.toISOString().replace(/\.\d+Z$/, "Z");
  const site = {
    title: str(data.site?.title, 80) || "CWシナリオ置き場",
    author: str(data.site?.author, 80),
    url: httpUrl(data.site?.url),
    note: str(data.site?.note, 2000),
  };

  // ---- アップローダー（置き場の中の棚） ----
  const boards = (data.boards?.length ? data.boards : [{ id: 1, title: site.title, visibility: "public" }]).map((b) => {
    let vis = pick(b.visibility, VIS, "public");
    const key = keyOf(b.key);
    if (vis === "unlisted" && !key) vis = "private";
    return { id: Number(b.id), title: str(b.title, 80) || "アップローダー", note: str(b.note, 2000), vis, path: vis === "unlisted" ? key : String(Number(b.id)) };
  }).filter((b) => Number.isInteger(b.id) && b.id >= 1);
  const boardById = new Map(boards.map((b) => [b.id, b]));

  // ---- ページ（HP） ----
  const pages = (pagesData.pages || []).map((p) => {
    let vis = pick(p.visibility, VIS, "public");
    const key = keyOf(p.key);
    if (vis === "unlisted" && !key) vis = "private";
    return {
      id: Number(p.id), title: str(p.title, 120) || "（無題）", body: str(p.body, 200000), vis,
      tags: [...new Set((p.tags || []).map((t) => str(t, 30).trim()).filter(Boolean))].slice(0, 30),
      created: str(p.created, 30), updated: str(p.updated, 30), path: `p/${vis === "unlisted" ? key : Number(p.id)}/`,
    };
  }).filter((p) => Number.isInteger(p.id) && p.id >= 1);
  const pageByTitle = new Map(pages.filter((p) => p.vis !== "private").map((p) => [p.title, p]));
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const homePage = pages.find((p) => p.id === Number(pagesData.home) && p.vis !== "private") || null;

  // ---- 作品 ----
  const plan = { upload: [], counters: [], copy: [], download: [], delete: [] };
  const keep = new Set();
  const items = [];
  const counts = {};
  const seen = new Set();
  for (const it of data.items || []) {
    const id = Number(it.id);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    const board = boardById.get(Number(it.board)) || boards[0];
    const own = pick(it.visibility, ["inherit", ...VIS], "inherit");
    let vis = own === "inherit" ? board.vis : stricter(board.vis, own);
    const key = keyOf(it.key);
    if (vis === "unlisted" && !key) vis = "private";
    const format = pick(it.format, FORMATS, "classic");
    const auto = compatOf(format);
    const out = {
      id, board, own, vis, path: vis === "unlisted" ? key : String(id),
      title: str(it.title, 120) || "（無題）",
      author: str(it.author, 80) || site.author,
      comment: str(it.comment, 2000),
      version: str(it.version, 30),
      type: pick(it.type, TYPES, "scenario"), format,
      compat: { cw150: pick(it.compat?.cw150, COMPAT, auto.cw150), next: pick(it.compat?.next, COMPAT, auto.next), py: pick(it.compat?.py, COMPAT, auto.py) },
      rating: pick(it.rating, RATINGS, "all"),
      convert: pick(it.convert, CONVERTS, "self"),
      tags: [...new Set((it.tags || []).map((t) => str(t, 30).trim()).filter(Boolean))].slice(0, 30),
      share: it.share === true,
      page: pageById.get(Number(it.page)) || null,
      created: str(it.created, 30), updated: str(it.updated, 30),
      file: null,
    };
    const f = it.file;
    const name = f && safeFileName(f.name);
    const rev = f && Number(f.rev);
    if (name && Number.isInteger(rev) && rev >= 1) {
      const an = assetName(id, rev);
      const inInbox = inbox.has(an), inRelease = assets.has(an);
      const enc = !!f.enc, size = Number(f.size) || 0;
      const path = `files/${out.path}/${rev}/${enc ? "data.enc" : name}`;
      const ok = (inInbox || inRelease) && size <= MAX_FILE;
      out.file = {
        name, size, sha256: /^[0-9a-f]{64}$/.test(f.sha256 || "") ? f.sha256 : "",
        enc: enc ? { iter: Number(f.enc.iter) || 0 } : null,
        path: ok && vis !== "private" ? encPath(path) : "", pending: !ok,
      };
      if (ok) {
        keep.add(an);
        if (inInbox && !inRelease) plan.upload.push(an);
        // 非公開の作品は、サイトには写さない（Releases には置いたまま）
        if (vis !== "private") (inInbox ? plan.copy : plan.download).push({ name: an, to: path });
      } else {
        // 新しい版がまだ届いていないあいだは、前の版を消さない
        for (const n of assets.keys()) if (n.startsWith(`f${id}.r`)) keep.add(n);
      }
    }
    const cn = counterName(id);
    keep.add(cn);
    if (!assets.has(cn)) plan.counters.push(cn);
    counts[id] = assets.get(cn)?.download_count || 0;
    items.push(out);
  }
  // 一覧に無い作品のファイルを Releases から消す（この仕組みが作った名前のものだけ）
  for (const n of assets.keys()) if (/^(f\d+\.r\d+\.bin|c\d+\.txt)$/.test(n) && !keep.has(n)) plan.delete.push(n);
  const itemById = new Map(items.map((it) => [it.id, it]));
  // その棚のページに並べる作品（作品ごとに「限定公開」「非公開」にしたものは並べない）
  const listed = (b) => items.filter((it) => it.board === b && it.vis !== "private" && it.own !== "unlisted");
  const publicItems = items.filter((it) => it.vis === "public");
  const publicBoards = boards.filter((b) => b.vis === "public");
  const publicPages = pages.filter((p) => p.vis === "public");

  // ---- CWカタログ形式（format 1）。「CWカタログで共有する」にした作品だけ ----
  const entry = (it, id) => {
    const page = `${base}d/${it.path}/`;
    const downloads = [];
    if (it.file && !it.file.pending && !it.file.enc) downloads.push({ label: site.title, url: base + it.file.path, kind: "direct", status: "active" });
    downloads.push(it.file?.enc
      ? { label: site.title, url: page, kind: "page", status: "active", note: "DLキーが必要です" }
      : { label: `${site.title}（DLページ）`, url: page, kind: "page", status: downloads.length ? "mirror" : "active" });
    const e = {
      id, owner, type: it.type, name: it.title, author: it.author || owner,
      version: it.version || "1.0", updated: (it.updated || it.created || generated).slice(0, 10),
      format: it.format, wsn_version: null, compat: it.compat, convert: it.convert, downloads,
    };
    if (it.file?.sha256) e.file = { name: it.file.name, sha256: it.file.sha256 };
    if (it.tags.length) e.tags = it.tags;
    if (it.comment) e.description = it.comment;
    if (it.rating !== "all") e.rating = it.rating;
    if (site.url) e.site = site.url;
    if (it.page && it.page.vis === "public") e.intro = [{ url: base + it.page.path, label: "紹介" }];
    return e;
  };
  const eid = (it) => "e" + String(it.id).padStart(5, "0");
  const catalog = (list) => ({
    format: 1, name: site.title,
    engines: [
      { id: "cw150", name: "CardWirth 1.50", formats: ["classic"], scenario_dir: "Scenario" },
      { id: "next", name: "CardWirthNext 1.60", formats: ["classic", "next"], scenario_dir: "Scenario" },
      { id: "py", name: "CardWirthPy", formats: ["classic", "wsn"], scenario_dir: "Scenario" },
    ],
    authors: { [owner]: { owner, names: [...new Set(list.map((e) => e.author))], ...(site.url ? { site: site.url } : {}) } },
    attribution: { name: site.title, url: base },
    entries: list,
  });
  const shared = publicItems.filter((it) => it.share && it.file);
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  // CWカタログは、区切りなしの JSON で指紋を取る。同じ書き方で置く
  let indexJson = null, r18Json = null, meta = null;
  if (shared.length) {
    indexJson = JSON.stringify(catalog(shared.filter((it) => it.rating !== "r18").map((it) => entry(it, eid(it)))));
    const r18 = shared.filter((it) => it.rating === "r18").map((it) => entry(it, eid(it)));
    r18Json = r18.length ? JSON.stringify(catalog(r18)) : null;
    meta = { format: 1, generated, count: shared.length - r18.length, sha256: sha(indexJson) };
    if (/^[0-9a-f]{40}$/.test(commit)) meta.commit = commit;
    if (r18Json) meta.r18 = { sha256: sha(r18Json) };
  }

  // ---- HTML の部品 ----
  const badges = (it) => (it.file?.enc ? '<span class="badge key" title="DLキーが必要です">鍵</span>' : "")
    + (RATING_NAME[it.rating] ? `<span class="badge r">${RATING_NAME[it.rating]}</span>` : "")
    + (it.vis === "unlisted" ? '<span class="badge">限定公開</span>' : "");
  const tagChips = (tags) => (tags.length ? `<span class="tags">${tags.map((t) => `<span class="tag" data-tag="${esc(t)}">${esc(t)}</span>`).join("")}</span>` : "");
  const compatChips = (it) => `<span class="tags">${Object.keys(ENGINE_NAME).map((k) => `<span class="chip c-${it.compat[k]}">${ENGINE_NAME[k]}：${COMPAT_NAME[it.compat[k]]}</span>`).join("")}</span>`;
  // 一覧に出すのは、遊べるエンジンの名前だけ（確認済み・動くはず）
  const engineOk = (it) => Object.keys(ENGINE_NAME).filter((k) => it.compat[k] === "verified" || it.compat[k] === "expected");
  const engineKey = (it) => engineOk(it).map((k) => ENGINE_NAME[k]).join(" ");
  const engineChips = (it) => engineOk(it).map((k) => `<span class="chip c-${it.compat[k]}" title="${ENGINE_NAME[k]}：${COMPAT_NAME[it.compat[k]]}">${ENGINE_NAME[k]}</span>`).join("") || '<span class="note">—</span>';
  function itemTable(list, root) {
    if (!list.length) return '<p class="note">作品がありません。</p>';
    const rows = list.slice().sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created)).map((it) => `<tr data-find="${esc(it.tags.join(" "))}">
<td data-v="${esc(it.title)}"><a href="${root}d/${it.path}/">${esc(it.title)}</a>${badges(it)}</td>
<td data-v="${esc(engineKey(it))}">${engineChips(it)}</td>
<td data-v="${esc(it.file?.name || "")}">${it.file ? esc(it.file.name) : "—"}${it.file?.pending ? '<span class="badge">準備中</span>' : ""}</td>
<td class="cmt" data-v="${esc(it.comment)}"><span class="clip" title="${esc(it.comment)}">${esc(it.comment)}</span></td>
<td class="num" data-v="${it.file?.size || 0}">${it.file ? fmtSize(it.file.size) : ""}</td>
<td class="date" data-v="${esc(it.created)}">${fmtDate(it.created)}</td>
<td class="date" data-v="${esc(it.updated || it.created)}">${fmtDate(it.updated || it.created)}</td>
<td class="num" data-count="${it.id}">${counts[it.id] || 0}</td></tr>`).join("\n");
    return `<div class="tools"><input type="search" class="q" placeholder="タイトル・ファイル名・コメント・タグで探す" size="36"><span class="note cnt">${list.length}件</span></div>
<div class="tablewrap"><table class="list" data-sortable><thead><tr><th>タイトル</th><th>対応</th><th>ファイル名</th><th>コメント</th><th>容量</th><th>投稿日時</th><th>更新日時</th><th>DL数</th></tr></thead><tbody>
${rows}
</tbody></table></div>`;
  }
  function dlCard(it, root) {
    const meta = [it.version && `ver ${esc(it.version)}`, it.file && fmtSize(it.file.size), fmtDate(it.updated || it.created), `DL数 <span data-count="${it.id}">${counts[it.id] || 0}</span>`].filter(Boolean).join("　");
    const btn = !it.file || it.file.pending ? '<span class="badge">準備中</span>'
      : it.file.enc ? `<a class="btn primary" href="${root}d/${it.path}/">DLページへ（DLキーが必要です）</a>`
      : `<a class="btn primary" href="${root}${it.file.path}" download data-countup="${it.id}">ダウンロード</a> <a class="btn" href="${root}d/${it.path}/">くわしく</a>`;
    return `<div class="card dlcard"><div class="dl-t"><a href="${root}d/${it.path}/">${esc(it.title)}</a>${badges(it)}</div>
<div class="note">${meta}</div>${it.comment ? `<p class="pre">${esc(it.comment)}</p>` : ""}${it.tags.length ? `<p>${tagChips(it.tags)}</p>` : ""}<div>${btn}</div></div>`;
  }
  const boardList = (root) => (publicBoards.length ? `<div class="tablewrap"><table class="list"><thead><tr><th>タイトル</th><th>作品数</th><th>ディスク</th></tr></thead><tbody>${publicBoards.map((b) => {
    const l = listed(b);
    return `<tr><td><a href="${root}u/${b.path}/">${esc(b.title)}</a></td><td class="num">${l.length}</td><td class="num">${fmtSize(l.reduce((s, it) => s + (it.file?.size || 0), 0))}</td></tr>`;
  }).join("")}</tbody></table></div>` : '<p class="note">アップローダーがありません。</p>');
  const pageList = (root, list = publicPages) => (list.length ? `<ul class="pagelist">${list.map((p) => `<li><a href="${root}${p.path}">${esc(p.title)}</a> <span class="note">${fmtDate(p.updated || p.created)}</span></li>`).join("")}</ul>` : '<p class="note">ページがありません。</p>');
  const wikiCtx = (root) => ({
    pageHref: (name) => (pageByTitle.has(name) ? root + pageByTitle.get(name).path : null),
    mediaHref: (name) => (/^[\w.\-]+$/.test(name) ? `${root}media/${name}` : null),
    dlLink(id, mode) {
      const it = itemById.get(id);
      if (!it || it.vis === "private") return null;
      // DLキーつき・準備中の作品は、DLページへ進んでもらう
      if (mode === "dl" && it.file && !it.file.pending && !it.file.enc) return { href: root + it.file.path, download: true, id: it.id };
      return { href: `${root}d/${it.path}/` };
    },
    embed(name, arg) {
      if (name === "dl") { const it = itemById.get(Number(arg)); return it && it.vis !== "private" ? dlCard(it, root) : '<p class="note">（この作品は表示できません）</p>'; }
      if (name === "dllist") {
        if (!arg) return itemTable(publicItems.filter((it) => it.own !== "unlisted"), root);
        const b = boardById.get(Number(arg));
        return b && b.vis !== "private" ? itemTable(listed(b), root) : '<p class="note">（このアップローダーは表示できません）</p>';
      }
      if (name === "pagelist") return pageList(root);
      if (name === "uploaders") return boardList(root);
      if (name === "recent") {
        const n = Math.min(Math.max(Number(arg) || 5, 1), 30);
        const all = [...publicPages.map((p) => ({ t: p.updated || p.created, href: root + p.path, title: p.title })),
          ...publicItems.filter((it) => it.own !== "unlisted").map((it) => ({ t: it.updated || it.created, href: `${root}d/${it.path}/`, title: it.title }))];
        return `<ul class="pagelist">${all.sort((a, b) => b.t.localeCompare(a.t)).slice(0, n).map((x) => `<li><a href="${x.href}">${esc(x.title)}</a> <span class="note">${fmtDate(x.t)}</span></li>`).join("")}</ul>`;
      }
      return null;
    },
  });

  // ---- ページの枠（テンプレート） ----
  const template = str(pagesData.template, 100000).trim() ? pagesData.template : DEFAULT_TEMPLATE;
  const out = new Map(); // 場所 → 中身
  function put(path, { title, content, noindex = false, isIndex = false }) {
    const depth = path.split("/").length - 1, root = depth ? "../".repeat(depth) : "./";
    const full = isIndex ? site.title : `${title} - ${site.title}`;
    const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://api.github.com https://github.com https://*.githubusercontent.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:">
${noindex ? '<meta name="robots" content="noindex">\n<meta name="referrer" content="no-referrer">\n' : ""}<title>${esc(full)}</title>
<link rel="stylesheet" href="${root}assets/style.css">
<link rel="stylesheet" href="${root}assets/custom.css">
<script type="application/json" id="cw-site">${JSON.stringify({ repo, tag: "files", root }).replace(/</g, "\\u003c")}</script>
<script type="module" src="${root}assets/site.js"></script>`;
    const nav = [
      `<a class="nav" href="${root}">トップ</a>`,
      publicBoards.length ? `<a class="nav" href="${root}u/${publicBoards.length === 1 ? publicBoards[0].path + "/" : ""}">アップローダー</a>` : "",
      publicPages.length ? `<a class="nav" href="${root}p/">ページ一覧</a>` : "",
    ].join("");
    const menu = str(pagesData.menu, 20000).trim() ? renderWiki(pagesData.menu, wikiCtx(root)) : "";
    out.set(path, applyTemplate(template, {
      head, root, nav, menu, content, page_title: esc(title), site_title: esc(site.title), site_author: esc(site.author),
      site_url: esc(site.url), site_note: esc(site.note), updated: fmtDate(generated), footer_text: esc(str(pagesData.design?.footer_text, 300) || site.title),
    }, { menu_area: !!menu, index_area: isIndex, not_index_area: !isIndex }));
    return root;
  }
  const rootOf = (path) => { const d = path.split("/").length - 1; return d ? "../".repeat(d) : "./"; };

  // 作品のDLページ
  for (const it of items) {
    if (it.vis === "private") continue;
    const path = `d/${it.path}/index.html`, root = rootOf(path), f = it.file, here = `${base}d/${it.path}/`;
    const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "");
    let dl;
    if (!f) dl = '<div class="msg">この作品には、まだファイルがありません。</div>';
    else if (f.pending) dl = '<div class="msg">ファイルを準備しています。数分たってから、もう一度開いてください。</div>';
    else if (!f.enc) dl = `<div class="card"><p><strong>${esc(f.name)}</strong> をダウンロードする準備ができました。ダウンロードするファイルをお確かめください。</p>
<a class="btn primary" href="${root}${f.path}" download data-countup="${it.id}">ダウンロード</a></div>`;
    else dl = `<div class="card" id="keybox" data-item="${esc(JSON.stringify({ id: it.id, name: f.name, path: f.path, sha256: f.sha256, iter: f.enc.iter }))}"><p><strong>${esc(f.name)}</strong> のダウンロードには、DLキーが必要です。</p>
<noscript><p class="note">ブラウザでこのページを開き、DLキーを入れてください。（スクリプトを有効にしてください）</p></noscript></div>`;
    const share = it.share && f ? `<h2>CWカタログで読む</h2>
<p class="note">この作品の情報（タグ・対応エンジン・配布先）を、CWカタログのデータ形式（format 1）で公開しています。CWカタログの「DL一覧を読み込む」で使えます。</p>
<div class="row"><input type="text" class="mono copybox" readonly size="60" value="${esc(here + "cw-catalog.json")}"></div>` : "";
    put(path, {
      title: it.title, noindex: it.vis === "unlisted",
      content: `<h1>${esc(it.title)}${badges(it)}</h1>
<div id="msg"></div>
${dl}
<table class="detail"><tbody>
${row("タイトル", esc(it.title))}${row("作者", esc(it.author))}${row("ファイル", f ? esc(f.name) : "")}${row("コメント", it.comment ? `<span class="pre">${esc(it.comment)}</span>` : "")}
${row("タグ", tagChips(it.tags))}${row("対応エンジン", compatChips(it))}${row("バージョン", esc(it.version))}${row("形式", FORMAT_NAME[it.format])}
${row("容量", f ? fmtSize(f.size) : "")}${row("投稿日時", fmtDate(it.created))}${row("更新日時", fmtDate(it.updated || it.created))}
<tr><th>ダウンロード</th><td data-count="${it.id}">${counts[it.id] || 0}</td></tr>
${row("SHA-256", f?.sha256 ? `<span class="mono">${f.sha256}</span>` : "")}${row("紹介ページ", it.page && it.page.vis !== "private" ? `<a href="${root}${it.page.path}">${esc(it.page.title)}</a>` : "")}
</tbody></table>
<h2>URL</h2>
<div class="row"><input type="text" class="mono copybox" readonly size="60" value="${esc(here)}"></div>
<p class="note">ファイルを新しい版に差し替えても、この URL は変わりません。</p>
${share}`,
    });
    if (it.share && f) out.set(`d/${it.path}/cw-catalog.json`, JSON.stringify({
      format: 1, kind: "cw-catalog/personal", name: it.title, exported: generated, tool: "", authors: {}, entries: [entry(it, "p00001")],
    }));
  }
  // アップローダーごとの一覧
  for (const b of boards) {
    if (b.vis === "private") continue;
    const path = `u/${b.path}/index.html`, root = rootOf(path);
    put(path, { title: b.title, noindex: b.vis === "unlisted",
      content: `<h1>${esc(b.title)}${b.vis === "unlisted" ? '<span class="badge">限定公開</span>' : ""}</h1>${b.note ? `<p class="pre">${esc(b.note)}</p>` : ""}${itemTable(listed(b), root)}` });
  }
  put("u/index.html", { title: "アップローダー", content: `<h1>アップローダー</h1>${boardList("../")}` });
  // ページ（HP）
  for (const p of pages) {
    if (p.vis === "private") continue;
    const path = `${p.path}index.html`, root = rootOf(path);
    put(path, { title: p.title, noindex: p.vis === "unlisted",
      content: `<article class="wikibody"><h1>${esc(p.title)}</h1>${renderWiki(p.body, wikiCtx(root))}${p.tags.length ? `<p class="pagetags">タグ：${tagChips(p.tags)}</p>` : ""}<p class="note">最終更新：${fmtDate(p.updated || p.created)}</p></article>` });
  }
  put("p/index.html", { title: "ページ一覧", content: `<h1>ページ一覧</h1>${pageList("../")}` });
  // トップ：トップにしたページ → 無ければ、アップローダーが1つならその一覧、いくつかあればアップローダーの一覧
  const catBox = indexJson ? `<h2>CWカタログで読む</h2><p class="note">「CWカタログで共有する」にした作品を、CWカタログのデータ形式（format 1）で公開しています。</p>
<div class="row"><input type="text" class="mono copybox" readonly size="60" value="${esc(base + "index.json")}"></div>` : "";
  const intro = `<h1>${esc(site.title)}${site.author ? `<small>${esc(site.author)}</small>` : ""}</h1>${site.note ? `<p class="pre">${esc(site.note)}</p>` : ""}${site.url ? `<p><a href="${esc(site.url)}" rel="noopener">${esc(site.url)}</a></p>` : ""}`;
  put("index.html", { title: site.title, isIndex: true,
    content: homePage ? `<article class="wikibody">${renderWiki(homePage.body, wikiCtx("./"))}</article>`
      : intro + (publicBoards.length === 1 ? itemTable(listed(publicBoards[0]), "./") : boardList("./")) + catBox });

  return { out, plan, counts: { generated, counts }, indexJson, r18Json, meta, site, repo, designCss: designCss(pagesData.design) };
}

function main() {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const outDir = arg("out", "_site");
  const inboxDir = arg("inbox", "_inbox");
  const read = (p, d) => (p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
  // --data：作品とページのデータの場所。ひな形のリポジトリでは、見本（sample）を使う
  const dataDir = join(ROOT, arg("data", "data"));
  const pagesData = read(join(dataDir, "pages.json"), {});
  const r = build({
    data: read(join(dataDir, "items.json"), { items: [] }), pagesData,
    release: read(arg("release"), { assets: [] }),
    inboxFiles: existsSync(inboxDir) ? readdirSync(inboxDir) : [],
    repo: arg("repo", process.env.GITHUB_REPOSITORY || "owner/repo"),
    commit: arg("commit", process.env.GITHUB_SHA || ""),
  });
  const w = (p, s) => { mkdirSync(dirname(join(outDir, p)), { recursive: true }); writeFileSync(join(outDir, p), s); };
  mkdirSync(outDir, { recursive: true });
  for (const p of ["admin", "assets"]) cpSync(join(ROOT, p), join(outDir, p), { recursive: true });
  const mediaDir = join(ROOT, arg("media", "media"));
  if (existsSync(mediaDir)) cpSync(mediaDir, join(outDir, "media"), { recursive: true });
  for (const [p, s] of r.out) w(p, s);
  w("assets/custom.css", r.designCss + (typeof pagesData.css === "string" ? pagesData.css : ""));
  w("site.json", JSON.stringify({ repo: r.repo, release_tag: "files" }));
  w("counts.json", JSON.stringify(r.counts));
  if (r.indexJson) { w("index.json", r.indexJson); w("meta.json", JSON.stringify(r.meta)); }
  if (r.r18Json) w("index-r18.json", r.r18Json);
  for (const c of r.plan.copy) { mkdirSync(dirname(join(outDir, c.to)), { recursive: true }); cpSync(join(inboxDir, c.name), join(outDir, c.to)); }
  for (const d of r.plan.download) mkdirSync(dirname(join(outDir, d.to)), { recursive: true });
  r.plan.copy = r.plan.copy.map((c) => c.name);
  writeFileSync(arg("plan", "_plan.json"), JSON.stringify(r.plan));
  console.log(`ページ ${r.out.size}件／置く ${r.plan.upload.length}・取得 ${r.plan.download.length}・消す ${r.plan.delete.length}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
