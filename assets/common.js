// 一覧・DLページ・管理ページで共通に使うもの
export const ROOT = new URL("..", import.meta.url); // サイトのいちばん上

// 文字は必ず文字として入れる（HTML として解釈しない）
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export function fmtSize(n) {
  if (!(n >= 0)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
export function fmtDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const RATING = { all: "", r15: "R15", r18: "R18" };
export const FORMAT = { classic: "クラシック（1.50）", next: "Next仕様", wsn: "Py仕様（WSN）", none: "シナリオ以外" };

