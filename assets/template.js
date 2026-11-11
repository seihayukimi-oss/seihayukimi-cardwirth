// 初期のテンプレート（デザインを変えていないときに使う枠）
export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="ja">
<head>
<%head%>
</head>
<body>
<header class="bar"><div class="in"><a class="brand" href="<%root%>"><%site_title%></a><%nav%></div></header>
<div class="wrap">
<main>
<%content%>
</main>
<!--menu_area-->
<input type="checkbox" id="menu-toggle" class="menu-toggle"><label for="menu-toggle" class="menu-btn" aria-label="メニュー">☰</label>
<aside class="side">
<%menu%>
</aside>
<!--/menu_area-->
</div>
<footer class="foot"><%footer_text%> <a class="adminlink" href="<%root%>admin/">管理ページ</a></footer>
</body>
</html>
`;

