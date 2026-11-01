/* xwlb 归档阅读站 — 零构建客户端渲染
   展示层金字塔重构（2026-11-01）：参考链接置顶 → 摘要 → 正文；TOC 01/02 层次编号。
   数据层 news/*.md 保持上游兼容格式，解析在渲染后 DOM 上做。 */
(function () {
  "use strict";

  var state = { catalogue: null, cache: new Map(), currentDate: null, md: window.markdownit({ html: true, linkify: true }) };
  var $ = function (id) { return document.getElementById(id); };

  /* ---- 主题 ---- */
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  applyTheme(saved || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("theme-toggle").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(cur);
    try { localStorage.setItem("theme", cur); } catch (e) {}
  });

  /* ---- 移动端抽屉 ---- */
  $("nav-toggle").addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
  $("overlay").addEventListener("click", function () { document.body.classList.remove("nav-open"); });

  /* ---- 路由（hash 只用于 #date=；文内锚点用 scrollIntoView，不污染 hash） ---- */
  function parseHash() {
    var m = location.hash.match(/^#date=(\d{8})$/);
    return m ? m[1] : null;
  }
  window.addEventListener("hashchange", function () {
    var d = parseHash();
    if (d && state.catalogue) { loadDate(d); }
  });

  function fmt(date) { return date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---- 侧栏渲染 ---- */
  function buildSidebar(filter) {
    var list = $("date-list");
    list.textContent = "";
    var items = state.catalogue.filter(function (c) {
      if (!filter) return true;
      return (c.date + " " + (c.abstract || "")).toLowerCase().indexOf(filter.toLowerCase()) >= 0;
    });
    $("stat").textContent = state.catalogue.length + " 天归档" + (filter ? " · 命中 " + items.length : "");
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "side-sub";
      empty.style.padding = "8px";
      empty.textContent = "无匹配日期";
      list.appendChild(empty);
      return;
    }
    var curYear = null, group = null, gitems = null;
    items.forEach(function (c) {
      var y = c.date.slice(0, 4);
      if (y !== curYear) {
        curYear = y;
        group = document.createElement("div");
        group.className = "year-group" + (y !== new Date().getFullYear() ? " collapsed" : "");
        var head = document.createElement("div");
        head.className = "year-head";
        head.textContent = y;
        head.addEventListener("click", function () { group.classList.toggle("collapsed"); });
        gitems = document.createElement("div");
        gitems.className = "year-items";
        group.appendChild(head); group.appendChild(gitems);
        list.appendChild(group);
      }
      var a = document.createElement("a");
      a.className = "date-item";
      a.href = "#date=" + c.date;
      a.dataset.date = c.date;
      var d = document.createElement("span");
      d.className = "d";
      d.textContent = fmt(c.date);
      var ab = document.createElement("span");
      ab.className = "a";
      ab.textContent = (c.abstract || "").replace(/\s+/g, " ").slice(0, 60);
      a.appendChild(d); a.appendChild(ab);
      a.addEventListener("click", function () { document.body.classList.remove("nav-open"); });
      gitems.appendChild(a);
    });
  }
  $("search").addEventListener("input", function () { buildSidebar(this.value.trim() || null); });

  function markActive(date) {
    document.querySelectorAll(".date-item").forEach(function (el) {
      el.classList.toggle("active", el.dataset.date === date);
    });
    var active = document.querySelector(".date-item.active");
    if (active && active.scrollIntoView) {
      var parent = document.getElementById("date-list");
      var pr = parent.getBoundingClientRect(), ar = active.getBoundingClientRect();
      if (ar.top < pr.top || ar.bottom > pr.bottom) active.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---- 消毒：md 含 CCTV 页面透传 HTML ---- */
  function sanitize(container) {
    container.querySelectorAll("script, iframe, style, object, embed").forEach(function (el) { el.remove(); });
    container.querySelectorAll("*").forEach(function (el) {
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        if (/^on/i.test(el.attributes[i].name)) el.removeAttribute(el.attributes[i].name);
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    });
    return container;
  }

  /* ---- 正文加载 ---- */
  function showSkeleton() {
    var c = $("content");
    c.textContent = "";
    for (var i = 0; i < 6; i++) {
      var s = document.createElement("div");
      s.className = "skeleton";
      c.appendChild(s);
    }
  }

  function renderDate404(date) {
    var c = $("content");
    c.textContent = "";
    var box = document.createElement("div");
    box.className = "error-box";
    box.textContent = fmt(date) + " 的稿件不存在。最近可用：";
    var ul = document.createElement("ul");
    ul.style.textAlign = "center";
    state.catalogue.slice(0, 3).forEach(function (e) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#date=" + e.date;
      a.textContent = fmt(e.date);
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    c.appendChild(box);
  }

  function loadDate(date) {
    state.currentDate = date;
    $("current-date").textContent = fmt(date) + " 《新闻联播》";
    document.title = "新闻联播 " + fmt(date);
    markActive(date);
    showSkeleton();
    var cached = state.cache.get(date);
    if (cached) return render(cached);
    fetch("news/" + date + ".md", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (md) { state.cache.set(date, md); render(md); })
      .catch(function (e) {
        if (String(e.message) === "404") return renderDate404(date);
        var c = $("content");
        c.textContent = "";
        var box = document.createElement("div");
        box.className = "error-box";
        box.textContent = "加载失败：" + e;
        var btn = document.createElement("button");
        btn.className = "retry";
        btn.textContent = "重试";
        btn.addEventListener("click", function () { state.cache.delete(date); loadDate(date); });
        box.appendChild(btn);
        c.appendChild(box);
      });
  }

  /* ---- 渲染 + 金字塔重构 ---- */
  function render(md) {
    var holder = document.createElement("div");
    holder.innerHTML = state.md.render(md);
    sanitize(holder);
    var frag = restructure(holder);
    var source = frag || holder;
    var c = $("content");
    c.textContent = "";
    while (source.firstChild) c.appendChild(source.firstChild);
    c.scrollTop = 0;
  }

  /* 解析渲染后的 DOM → 金字塔布局：
     meta/参考链接条 → 目录（01/02 层次）→ 01 摘要 → 02 详细新闻（条目 01..NN）
     结构不符（如上游格式变化）时返回 null，退回原样渲染 */
  function restructure(holder) {
    var h1 = holder.querySelector("h1");
    var absH = null, detailH = null;
    holder.querySelectorAll("h2").forEach(function (h) {
      var t = h.textContent;
      if (t.indexOf("新闻摘要") >= 0) absH = h;
      else if (t.indexOf("详细新闻") >= 0) detailH = h;
    });
    if (!absH || !detailH) return null;
    var date = state.currentDate || "";

    function collectAfter(start) { // start 的后续兄弟，直到下一个 h2
      var out = [];
      var n = start.nextSibling;
      while (n) {
        var next = n.nextSibling;
        if (n.tagName === "H2") break;
        out.push(n);
        n = next;
      }
      return out;
    }

    // 详细新闻按 h3 切条目
    var items = [], cur = null;
    collectAfter(detailH).forEach(function (n) {
      if (n.tagName === "H3") { cur = { h: n, nodes: [] }; items.push(cur); }
      else if (cur) { cur.nodes.push(n); }
    });

    var frag = document.createDocumentFragment();

    // -- 标题 --
    if (h1) frag.appendChild(h1);

    // -- 参考信息条（置顶）--
    var meta = document.createElement("div");
    meta.className = "meta-bar";
    var m1 = document.createElement("span");
    m1.textContent = "播出 " + fmt(date);
    var m2 = document.createElement("span");
    m2.textContent = "条目 " + items.length;
    var m3 = document.createElement("a");
    m3.href = "https://tv.cctv.com/lm/xwlb/day/" + date + ".shtml";
    m3.target = "_blank";
    m3.rel = "noopener";
    m3.textContent = "央视网当日页 ↗";
    meta.appendChild(m1); meta.appendChild(m2); meta.appendChild(m3);
    frag.appendChild(meta);

    // -- 目录（01/02 层次）--
    var toc = document.createElement("nav");
    toc.className = "toc";
    var tocTitle = document.createElement("div");
    tocTitle.className = "toc-title";
    tocTitle.textContent = "目录";
    toc.appendChild(tocTitle);
    var l1 = document.createElement("ol");
    l1.className = "toc-l1";

    function tocEntry(num, text, target, sub) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.textContent = num + "　" + text;
      a.href = "#";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (target && target.scrollIntoView) target.scrollIntoView({ block: "start" });
      });
      li.appendChild(a);
      if (sub) li.appendChild(sub);
      return li;
    }

    // -- 01 摘要节 --
    var sec1 = document.createElement("section");
    var sh1 = document.createElement("h2");
    sh1.textContent = "01 · 新闻摘要";
    sec1.appendChild(sh1);
    collectAfter(absH).forEach(function (n) { sec1.appendChild(n); });

    // -- 02 详细新闻节（条目 01..NN）--
    var sec2 = document.createElement("section");
    var sh2 = document.createElement("h2");
    sh2.textContent = "02 · 详细新闻";
    sec2.appendChild(sh2);
    var l2 = document.createElement("ol");
    l2.className = "toc-l2";
    items.forEach(function (it, i) {
      var num = pad2(i + 1);
      var title = it.h.textContent.replace(/^\d+\s*[.、]\s*/, "");
      it.h.textContent = num + " · " + title;
      it.h.id = "item-" + num;
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.textContent = num + "　" + title;
      a.href = "#";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        it.h.scrollIntoView({ block: "start" });
      });
      li.appendChild(a);
      l2.appendChild(li);
      sec2.appendChild(it.h);
      it.nodes.forEach(function (n) { sec2.appendChild(n); });
    });

    l1.appendChild(tocEntry("01", "新闻摘要", sec1, null));
    l1.appendChild(tocEntry("02", "详细新闻", sec2, l2));
    toc.appendChild(l1);
    frag.appendChild(toc);

    frag.appendChild(sec1);
    frag.appendChild(sec2);
    return frag;
  }

  /* ---- 启动 ---- */
  fetch("news/catalogue.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("catalogue " + r.status); return r.json(); })
    .then(function (cat) {
      state.catalogue = cat && cat.length ? cat : [];
      buildSidebar(null);
      var d = parseHash();
      if (!d || !state.catalogue.some(function (c) { return c.date === d; })) {
        d = state.catalogue.length ? state.catalogue[0].date : null;
      }
      if (d) loadDate(d);
      else {
        $("content").textContent = "";
        var box = document.createElement("div");
        box.className = "error-box";
        box.textContent = "归档为空（等待首次抓取）";
        $("content").appendChild(box);
      }
    })
    .catch(function (e) {
      $("stat").textContent = "catalogue 加载失败";
      $("content").textContent = "";
      var box = document.createElement("div");
      box.className = "error-box";
      box.textContent = "加载失败：" + e;
      $("content").appendChild(box);
    });
})();
