/* xwlb 归档阅读站 — 零构建客户端渲染 */
(function () {
  "use strict";

  var state = { catalogue: null, cache: new Map(), md: window.markdownit({ html: true, linkify: true }) };
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

  /* ---- 路由 ---- */
  function parseHash() {
    var m = location.hash.match(/^#date=(\d{8})$/);
    return m ? m[1] : null;
  }
  window.addEventListener("hashchange", function () {
    var d = parseHash();
    if (d && state.catalogue) { loadDate(d); }
  });

  function fmt(date) { return date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8); }

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

  function render(md) {
    var holder = document.createElement("div");
    holder.innerHTML = state.md.render(md);
    sanitize(holder);
    var c = $("content");
    c.textContent = "";
    while (holder.firstChild) c.appendChild(holder.firstChild);
    document.querySelector("#content").scrollTop = 0;
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
