// Wiki記法 → HTML（公開のときの組み立てと、管理ページのプレビューの両方で使う）
// 書いた文字はすべて文字として扱う（HTML のタグは効かない）。記法は docs/Wiki記法.md にまとめてある。
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/;
const IMG = /\.(png|jpe?g|gif|webp|svg)(\?[^\s]*)?$/i;
const isUrl = (s) => /^https?:\/\//i.test(s);
const sizeOf = (v) => { const n = Number(v); return n >= 6 && n <= 72 ? n : null; };

// ctx: { pageHref(name) → URL か null, mediaHref(name) → URL, embed(name, arg) → HTML か null,
//        dlLink(番号, 'dl'|'dlpage') → { href, download?, id? } か null }
export function renderWiki(src, ctx = {}) {
  const heads = [];
  const notes = [];
  const pageHref = ctx.pageHref || (() => null);
  const media = (u) => (isUrl(u) ? u : ctx.mediaHref ? ctx.mediaHref(u) : null);

  function img(arg) {
    const [u, w, h] = arg.split(",").map((x) => x.trim());
    const url = media(u || "");
    if (!url) return esc(`&ref(${arg})`);
    const dim = (v, k) => (/^\d{1,4}$/.test(v || "") ? ` ${k}="${v}"` : "");
    return `<img src="${esc(url)}" alt=""${dim(w, "width")}${dim(h, "height")} loading="lazy">`;
  }
  function link(body) {
    let label, target, blank = false;
    let i = body.indexOf(">>");
    if (i >= 0 && isUrl(body.slice(i + 2).replace(/^>/, ""))) { label = body.slice(0, i); target = body.slice(i + 2).replace(/^>/, ""); blank = true; }
    else if ((i = body.indexOf(">")) >= 0) { label = body.slice(0, i); target = body.slice(i + 1); }
    else { label = target = body; }
    target = target.trim();
    const inner = isUrl(label.trim()) && IMG.test(label.trim()) ? `<img src="${esc(label.trim())}" alt="" loading="lazy">` : inline(label);
    if (isUrl(target)) return `<a href="${esc(target)}" rel="noopener"${blank ? ' target="_blank"' : ""}>${inner}</a>`;
    if (target.startsWith("#")) return `<a href="#${esc(encodeURIComponent(target.slice(1)))}">${inner}</a>`;
    const [name, anchor] = target.split("#");
    const href = pageHref(name.trim());
    if (!href) return `<span class="nolink" title="このページはまだありません">${inner}</span>`;
    return `<a href="${esc(href)}${anchor ? "#" + esc(encodeURIComponent(anchor)) : ""}">${inner}</a>`;
  }
  // &名前(引数){中身} の、対応する } を探す
  function braced(s, from) {
    let depth = 0;
    for (let i = from; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) return i;
    }
    return -1;
  }
  const RE = /&(size|color|align|sup|dl|dlpage)\(([^)]*)\)\{|&ref\(([^)]*)\)|&aname\(([\w-]{1,40})\)|\[\[(.+?)\]\]|'''(.+?)'''|''(.+?)''|%%%(.+?)%%%|%%(.+?)%%|__(.+?)__|\(\((.+?)\)\)|(https?:\/\/[^\s<>"'\]）」】]+)|~~/;
  function inline(s) {
    let out = "";
    while (s) {
      const m = RE.exec(s);
      if (!m) { out += esc(s); break; }
      out += esc(s.slice(0, m.index));
      let rest = s.slice(m.index + m[0].length);
      if (m[1]) {
        const open = m.index + m[0].length - 1, close = braced(s, open);
        if (close < 0) { out += esc(m[0]); s = rest; continue; }
        const inner = inline(s.slice(open + 1, close)), a = m[2].split(",").map((x) => x.trim());
        rest = s.slice(close + 1);
        if (m[1] === "dl" || m[1] === "dlpage") {
          const l = ctx.dlLink ? ctx.dlLink(Number(a[0]), m[1]) : null;
          out += l ? `<a class="dllink" href="${esc(l.href)}"${l.download ? ` download data-countup="${Number(l.id)}"` : ""}>${inner}</a>` : inner;
        } else if (m[1] === "sup") out += `<sup>${inner}</sup>`;
        else if (m[1] === "size") out += sizeOf(a[0]) ? `<span style="font-size:${sizeOf(a[0])}px">${inner}</span>` : inner;
        else if (m[1] === "color") {
          const st = (COLOR.test(a[0] || "") ? `color:${a[0]};` : "") + (COLOR.test(a[1] || "") ? `background-color:${a[1]};` : "");
          out += st ? `<span style="${st}">${inner}</span>` : inner;
        } else out += ["left", "center", "right"].includes(a[0]) ? `<span class="al" style="text-align:${a[0]}">${inner}</span>` : inner;
      } else if (m[3] != null) out += img(m[3]);
      else if (m[4]) out += `<a id="${esc(m[4])}"></a>`;
      else if (m[5]) out += link(m[5]);
      else if (m[6]) out += `<em>${inline(m[6])}</em>`;
      else if (m[7]) out += `<strong>${inline(m[7])}</strong>`;
      else if (m[8]) out += `<ins>${inline(m[8])}</ins>`;
      else if (m[9]) out += `<del>${inline(m[9])}</del>`;
      else if (m[10]) out += `<sub>${inline(m[10])}</sub>`;
      else if (m[11]) { notes.push(inline(m[11])); out += `<sup class="fn"><a href="#fn-${notes.length}" id="fnr-${notes.length}">*${notes.length}</a></sup>`; }
      else if (m[12]) out += IMG.test(m[12]) ? `<img src="${esc(m[12])}" alt="" loading="lazy">` : `<a href="${esc(m[12])}" rel="noopener">${esc(m[12])}</a>`;
      else out += "<br>";
      s = rest;
    }
    return out;
  }

  function table(rows) {
    const grid = rows.map((r) => {
      let cells = r.slice(1, -1).split("|");
      const headRow = cells[0]?.startsWith("~");
      if (headRow) cells[0] = cells[0].slice(1);
      return cells.map((c) => {
        const cell = { th: headRow, st: "", text: c, span: 1, rows: 1, skip: false };
        for (;;) {
          let m;
          if (cell.text.startsWith("!")) { cell.th = true; cell.text = cell.text.slice(1); }
          else if ((m = /^(left|center|right):/.exec(cell.text))) { cell.st += `text-align:${m[1]};`; cell.text = cell.text.slice(m[0].length); }
          else if ((m = /^(bgcolor|color|size)\(([^)]*)\):/.exec(cell.text))) {
            if (m[1] === "size") { if (sizeOf(m[2])) cell.st += `font-size:${sizeOf(m[2])}px;`; }
            else if (COLOR.test(m[2])) cell.st += `${m[1] === "color" ? "color" : "background-color"}:${m[2]};`;
            cell.text = cell.text.slice(m[0].length);
          } else break;
        }
        return cell;
      });
    });
    grid.forEach((row, y) => row.forEach((c, x) => {
      if (c.text.trim() === ">" && row[x + 1]) { row[x + 1].span += c.span; c.skip = true; }
      else if (c.text.trim() === "^" && y > 0) {
        let up = y - 1;
        while (up > 0 && grid[up][x]?.skip) up--;
        if (grid[up][x]) { grid[up][x].rows++; c.skip = true; }
      }
    }));
    return `<div class="tablewrap"><table class="wiki">${grid.map((row) => `<tr>${row.filter((c) => !c.skip).map((c) => {
      const t = c.th ? "th" : "td";
      return `<${t}${c.span > 1 ? ` colspan="${c.span}"` : ""}${c.rows > 1 ? ` rowspan="${c.rows}"` : ""}${c.st ? ` style="${c.st}"` : ""}>${inline(c.text)}</${t}>`;
    }).join("")}</tr>`).join("")}</table></div>`;
  }
  function list(items) {
    // items: [{ depth, ordered, text }]
    let out = "", stack = [];
    for (const it of items) {
      while (stack.length > it.depth) out += `</li></${stack.pop()}>`;
      if (stack.length === it.depth && stack.length) {
        const want = it.ordered ? "ol" : "ul";
        if (stack[stack.length - 1] !== want) { out += `</li></${stack.pop()}>`; }
        else out += "</li>";
      }
      while (stack.length < it.depth) { const t = it.ordered ? "ol" : "ul"; out += `<${t}>`; stack.push(t); if (stack.length < it.depth) out += "<li>"; }
      out += `<li>${inline(it.text)}`;
    }
    while (stack.length) out += `</li></${stack.pop()}>`;
    return out;
  }

  function blocks(lines) {
    let out = "", para = [];
    const flush = () => { if (para.length) { out += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if ((m = /^=\|([A-Za-z]*)\|$/.exec(line.trim()))) {
        flush();
        const buf = [];
        for (i++; i < lines.length && lines[i].trim() !== "||="; i++) buf.push(lines[i]);
        const kind = m[1].toUpperCase();
        if (kind === "SAMPLE") out += `<div class="sample"><div class="sample-t">書き方</div><pre class="code">${esc(buf.join("\n"))}</pre><div class="sample-t">こう表示されます</div><div class="sample-out">${blocks(buf)}</div></div>`;
        else out += `<pre class="${{ BOX: "box", AA: "aa", CODE: "code" }[kind] || "plain"}">${esc(buf.join("\n"))}</pre>`;
      } else if ((m = /^\[([+-])\](.*)$/.exec(line))) {
        flush();
        const buf = [];
        let depth = 1;
        for (i++; i < lines.length; i++) {
          if (/^\[[+-]\]/.test(lines[i])) depth++;
          else if (lines[i].trim() === "[END]" && --depth === 0) break;
          buf.push(lines[i]);
        }
        out += `<details${m[1] === "-" ? " open" : ""}><summary>${inline(m[2].trim() || "開く")}</summary>${blocks(buf)}</details>`;
      } else if (line.startsWith("//")) { /* コメント（表示しない） */ }
      else if (line.trim() === "#contents") { flush(); out += "\u0000TOC\u0000"; }
      else if ((m = /^#ref\(([^)]*)\)\s*$/.exec(line))) { flush(); out += `<p>${img(m[1])}</p>`; }
      else if ((m = /^#([a-z]+)\(([^)]*)\)\s*$/.exec(line)) && ctx.embed && ctx.embed(m[1], m[2].trim()) != null) { flush(); out += ctx.embed(m[1], m[2].trim()); }
      else if (/^-{4,}\s*$/.test(line)) { flush(); out += "<hr>"; }
      else if ((m = /^(\*{1,3})(.*)$/.exec(line))) {
        flush();
        const lv = m[1].length + 1, id = `h-${heads.length + 1}`, html = inline(m[2].trim());
        heads.push({ lv, id, html });
        out += `<h${lv} id="${id}">${html}</h${lv}>`;
      } else if (/^[-+]{1,3}(?![-+])/.test(line)) {
        flush();
        const items = [];
        for (; i < lines.length && (m = /^([-+]{1,3})(?![-+])(.*)$/.exec(lines[i])); i++) items.push({ depth: m[1].length, ordered: m[1][0] === "+", text: m[2].trim() });
        i--;
        out += list(items);
      } else if (line.startsWith(">")) {
        flush();
        const buf = [];
        for (; i < lines.length && lines[i].startsWith(">"); i++) buf.push(lines[i].slice(1));
        i--;
        out += `<blockquote>${buf.map(inline).join("<br>")}</blockquote>`;
      } else if (/^\|.*\|\s*$/.test(line)) {
        flush();
        const rows = [];
        for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i].trim());
        i--;
        out += table(rows);
      } else if (!line.trim()) flush();
      else para.push(line);
    }
    flush();
    return out;
  }

  let html = blocks(String(src ?? "").replace(/\r\n?/g, "\n").split("\n"));
  const toc = heads.length ? `<nav class="toc"><div class="toc-t">目次</div><ul>${heads.map((h) => `<li class="lv${h.lv}"><a href="#${h.id}">${h.html.replace(/<a\b[^>]*>|<\/a>/g, "")}</a></li>`).join("")}</ul></nav>` : "";
  html = html.split("\u0000TOC\u0000").join(toc);
  if (notes.length) html += `<ol class="notes">${notes.map((n, i) => `<li id="fn-${i + 1}">${n} <a href="#fnr-${i + 1}">↩</a></li>`).join("")}</ol>`;
  return html;
}
