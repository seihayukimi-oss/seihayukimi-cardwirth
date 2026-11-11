// node --test scripts/build.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build, assetName, counterName, safeFileName, applyTemplate, designCss } from "./build.mjs";
import { encryptBytes, decryptBytes, sha256Hex } from "../assets/enc.js";
import { renderWiki } from "../assets/wiki.js";

const K1 = "abcdefghijkl0001", K2 = "abcdefghijkl0002", K3 = "abcdefghijkl0003";
const item = (o) => ({ id: 1, board: 1, title: "サンプル店", comment: "テスト用の作品です。", tags: ["店シナ"], key: K1, created: "2026-11-01T00:00:00Z", updated: "2026-11-02T00:00:00Z",
  file: { name: "サンプル店_ver1_00.zip", size: 1000, sha256: "a".repeat(64), rev: 1, enc: null }, ...o });
const boards = [{ id: 1, title: "テスト棚", visibility: "public", key: K1 }, { id: 2, title: "企画の棚", visibility: "unlisted", key: K2 }, { id: 3, title: "しまってある棚", visibility: "private", key: K3 }];
const run = (items, assets = [], inboxFiles = [], pagesData = {}) => build({ data: { site: { title: "テスト置き場", author: "テスト作者" }, boards, items }, pagesData, release: { assets }, inboxFiles, repo: "Test-Author/okiba", now: new Date("2026-11-03T00:00:00Z") });
const all = (r) => [...r.out.values()].join("\n");

test("届いたばかりのファイルは、Releases に置いてサイトに写す", () => {
  const r = run([item()], [], [assetName(1, 1)]);
  assert.deepEqual(r.plan.upload, ["f1.r1.bin"]);
  assert.deepEqual(r.plan.copy, [{ name: "f1.r1.bin", to: "files/1/1/サンプル店_ver1_00.zip" }]);
  assert.deepEqual(r.plan.counters, ["c1.txt"]);
});

test("置いてあるファイルは Releases から取得し、古い版と消した作品のファイルは消す", () => {
  const assets = [{ name: "f1.r1.bin" }, { name: "f1.r2.bin" }, { name: "c1.txt", download_count: 12 }, { name: "f9.r1.bin" }, { name: "c9.txt" }, { name: "ほかのファイル.zip" }];
  const r = run([item({ file: { ...item().file, rev: 2 } })], assets);
  assert.deepEqual(r.plan.download, [{ name: "f1.r2.bin", to: "files/1/2/サンプル店_ver1_00.zip" }]);
  assert.deepEqual(r.plan.delete.sort(), ["c9.txt", "f1.r1.bin", "f9.r1.bin"]);
  assert.equal(r.counts.counts[1], 12);
});

test("新しい版がまだ届いていないときは準備中にして、前の版を消さない", () => {
  const r = run([item({ file: { ...item().file, rev: 2 } })], [{ name: "f1.r1.bin" }, { name: "c1.txt" }]);
  assert.match(r.out.get("d/1/index.html"), /ファイルを準備しています/);
  assert.deepEqual(r.plan.delete, []);
});

test("DLページは出来上がった HTML で、スクリプトなしでもファイルへのリンクが読める", () => {
  const r = run([item()], [{ name: "f1.r1.bin" }]);
  const html = r.out.get("d/1/index.html");
  assert.match(html, /<title>サンプル店 - テスト置き場<\/title>/);
  assert.match(html, /<a class="btn primary" href="\.\.\/\.\.\/files\/1\/1\/[^"]+\.zip" download/);
  assert.ok(!html.includes("<form"));
  assert.match(html, /1\.50：動くはず/);
});

test("限定公開・非公開：一覧に出さず、限定公開は推測できない URL、非公開はサイトに出さない", () => {
  const assets = [1, 2, 3, 4].map((i) => ({ name: `f${i}.r1.bin` }));
  const r = run([
    item(),
    item({ id: 2, title: "デバッグ読みシナ", visibility: "unlisted", key: K2 }),
    item({ id: 3, title: "ひみつの冒険", visibility: "private", key: K3 }),
    item({ id: 4, title: "企画のテスト配布", board: 2, key: "zzzzzzzzzzzz0004" }),
  ], assets);
  assert.ok(r.out.has(`d/${K2}/index.html`) && !r.out.has("d/2/index.html"));
  assert.match(r.out.get(`d/${K2}/index.html`), /noindex/);
  assert.ok(!r.out.get("u/1/index.html").includes("デバッグ読みシナ"));
  assert.ok(!all(r).includes("ひみつの冒険"));
  assert.ok(!r.plan.download.some((d) => d.name === "f3.r1.bin") && !r.plan.delete.includes("f3.r1.bin"));
  // 限定公開の棚：棚の URL を知っている人には並べて見せる。公開のページからは見えない
  assert.ok(r.out.get(`u/${K2}/index.html`).includes("企画のテスト配布"));
  assert.ok(!r.out.get("index.html").includes("企画") && !r.out.get("u/index.html").includes("企画"));
  assert.ok(![...r.out.keys()].some((k) => k.startsWith("u/3/") || k.startsWith(`u/${K3}/`)));
});

test("CWカタログ形式は「共有する」にした作品だけ。無ければ index.json も作らない", () => {
  const assets = [{ name: "f1.r1.bin" }, { name: "f2.r1.bin" }, { name: "f3.r1.bin" }];
  const none = run([item()], assets);
  assert.equal(none.indexJson, null);
  assert.ok(!none.out.has("d/1/cw-catalog.json") && !all(none).includes("index.json") && !all(none).includes("cw-catalog.json"));
  const r = run([
    item({ share: true, compat: { cw150: "no", next: "verified" } }),
    item({ id: 2, title: "テスト冒険譚", share: true, key: K2, file: { ...item().file, name: "テスト冒険譚.zip", enc: { v: 1, iter: 600000 } } }),
    item({ id: 3, title: "デバッグ読みシナ", key: K3 }),
  ], assets);
  const cat = JSON.parse(r.indexJson);
  assert.deepEqual(cat.entries.map((e) => e.name), ["サンプル店", "テスト冒険譚"]);
  const [a, b] = cat.entries;
  assert.deepEqual(a.compat, { cw150: "no", next: "verified", py: "expected" });
  assert.deepEqual(a.tags, ["店シナ"]);
  assert.equal(a.downloads[0].url, "https://test-author.github.io/okiba/files/1/1/" + encodeURIComponent("サンプル店_ver1_00.zip"));
  assert.deepEqual(b.downloads.map((d) => d.kind), ["page"]);
  // CWカタログは、区切りなしの JSON で指紋を比べる
  assert.equal(r.meta.sha256, createHash("sha256").update(JSON.stringify(cat)).digest("hex"));
  const one = JSON.parse(r.out.get("d/1/cw-catalog.json"));
  assert.equal(one.kind, "cw-catalog/personal");
  assert.equal(one.entries[0].id, "p00001");
  assert.match(r.out.get("d/1/index.html"), /cw-catalog\.json/);
  assert.ok(!r.out.has("d/3/cw-catalog.json") && !r.out.get("d/3/index.html").includes("cw-catalog.json"));
  assert.ok(!r.indexJson.includes("dlkey"));
});

test("ページ（HP）：Wiki記法・埋め込み・トップページ・テンプレート", () => {
  const pagesData = { home: 1, menu: "*メニュー\n-[[作品の紹介]]", pages: [
    { id: 1, title: "トップ", body: "*ようこそ\n#dl(1)\n#dllist(1)\n[[作品の紹介]] [[無いページ]]", visibility: "public", key: K1 },
    { id: 2, title: "作品の紹介", body: "''太字'' と <script>alert(1)</script>", visibility: "public", key: K2 },
    { id: 3, title: "下書き", body: "ないしょ", visibility: "private", key: K3 }] };
  const r = run([item({ page: 2 })], [{ name: "f1.r1.bin" }], [], pagesData);
  const top = r.out.get("index.html");
  assert.match(top, /<h2 id="h-1">ようこそ<\/h2>/);
  assert.match(top, /class="card dlcard"/);
  assert.match(top, /<a href="\.\/p\/2\/">作品の紹介<\/a>/);
  assert.match(top, /class="nolink"/);
  assert.match(top, /<aside class="side">/);
  assert.ok(!r.out.get("u/1/index.html").includes("ないしょ"));
  const p2 = r.out.get("p/2/index.html");
  assert.match(p2, /<strong>太字<\/strong>/);
  assert.ok(!p2.includes("<script>alert"));
  assert.ok(!all(r).includes("ないしょ"));
  assert.match(r.out.get("d/1/index.html"), /紹介ページ/);
  assert.equal(applyTemplate("<%a%>|<!--x-->X<!--/x-->|<!--y-->Y<!--/y-->", { a: "A" }, { x: true, y: false }), "A|X|");
});

test("Wiki記法：表・リスト・色・リンクは安全な形にする", () => {
  const html = renderWiki("|~名前|値|\n|left:a|bgcolor(#fee):b|\n-一\n--二\n+三\n&color(red){赤}&color(javascript:x){だめ}\n[[外>https://example.com/]] [[x>javascript:alert(1)]]\n=||\n<b>そのまま</b>\n||=");
  assert.match(html, /<th>名前<\/th>/);
  assert.match(html, /<td style="background-color:#fee;">b<\/td>/);
  assert.match(html, /<ul><li>一<ul><li>二<\/li><\/ul><\/li><\/ul><ol><li>三<\/li><\/ol>/);
  assert.match(html, /<span style="color:red;">赤<\/span>だめ/);
  assert.match(html, /<a href="https:\/\/example\.com\/" rel="noopener">外<\/a>/);
  assert.ok(!/href="javascript/i.test(html));
  assert.match(html, /&lt;b&gt;そのまま&lt;\/b&gt;/);
});

test("一覧は1行で、タグは遊べるエンジンだけ。画像のDLリンク・管理ページへのリンク", () => {
  const assets = [{ name: "f1.r1.bin" }, { name: "f2.r1.bin" }];
  const pagesData = { pages: [{ id: 1, title: "紹介", visibility: "public", key: K1, body: "&dl(1){&ref(banner.png)} &dlpage(1){くわしく} &dl(2){鍵つき} &dl(99){無い}" }] };
  const r = run([item({ format: "next" }), item({ id: 2, key: K2, title: "テスト冒険譚", file: { ...item().file, enc: { v: 1, iter: 1 } } })], assets, [], pagesData);
  const list = r.out.get("u/1/index.html");
  assert.match(list, /<span class="chip c-expected" title="Next：動くはず">Next<\/span>/);
  assert.equal(list.split(">Py</span>").length - 1, 1); // Next仕様の作品には Py を出さない（クラシックの1件だけ）
  assert.ok(!list.includes('class="tag"'));
  assert.match(list, /data-find="店シナ"/);
  const p = r.out.get("p/1/index.html");
  assert.match(p, /<a class="dllink" href="\.\.\/\.\.\/files\/1\/1\/[^"]+\.zip" download data-countup="1"><img src="\.\.\/\.\.\/media\/banner\.png"/);
  assert.match(p, /<a class="dllink" href="\.\.\/\.\.\/d\/1\/">くわしく<\/a>/);
  assert.match(p, /<a class="dllink" href="\.\.\/\.\.\/d\/2\/">鍵つき<\/a> 無い/);
  assert.match(p, /<a class="adminlink" href="\.\.\/\.\.\/admin\/">管理ページ<\/a>/);
});

test("デザインのかんたん設定：色・画像・メニューの位置を CSS にする（おかしな値は通さない）", () => {
  const css = designCss({ header_bg: "#223344", header_fg: "white", page_img: "bg.png", page_img_mode: "fixed", footer_bg: "red;}body{display:none", header_img: "https://example.com/a.png", menu_pos: "drawer", link: "javascript:x" });
  assert.match(css, /\.bar\{background-color:#223344;background-image:url\("https:\/\/example\.com\/a\.png"\)/);
  assert.match(css, /body\{background-image:url\("\.\.\/media\/bg\.png"\);[^}]*background-attachment:fixed/);
  assert.match(css, /\.menu-toggle:checked~\.side/);
  assert.ok(!css.includes("display:none") && !css.includes("javascript"));
  assert.equal(designCss({}), "");
  assert.match(designCss({ menu_pos: "left", menu_sticky: true }), /row-reverse[\s\S]*position:sticky/);
});

test("コードの枠と書き方の見本：コードは文字のまま出し、見本は出来上がりも並べる", () => {
  const html = renderWiki("=|CODE|\n''太字'' <b>\n[+]x\n||=\n=|SAMPLE|\n''太字''\n-一\n||=");
  assert.match(html, /<pre class="code">&#39;&#39;太字&#39;&#39; &lt;b&gt;\n\[\+\]x<\/pre>/);
  assert.match(html, /<div class="sample">.*<pre class="code">&#39;&#39;太字&#39;&#39;\n-一<\/pre>.*<div class="sample-out"><p><strong>太字<\/strong><\/p><ul><li>一<\/li><\/ul><\/div><\/div>/s);
});

test("危ないファイル名は受け付けない", () => {
  assert.equal(safeFileName(".."), "");
  assert.equal(safeFileName("a/b\\c.zip"), "a_b_c.zip");
  assert.equal(counterName(5), "c5.txt");
});

test("DLキー：合えば元に戻り、違えば開けない", async () => {
  const plain = new TextEncoder().encode("テスト用の中身");
  const enc = await encryptBytes(plain, "ながいDLキー", 1000);
  assert.equal(await sha256Hex(await decryptBytes(enc, "ながいDLキー", 1000)), await sha256Hex(plain));
  await assert.rejects(decryptBytes(enc, "ちがうキー", 1000), /bad-key/);
});
