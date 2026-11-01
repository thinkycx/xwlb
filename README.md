# xwlb — 新闻联播文字稿归档

每日自动爬取央视网《新闻联播》文字稿，GitHub Actions 提交归档，GitHub Pages 提供阅读站。

- 数据来源：`https://tv.cctv.com/lm/xwlb/day/YYYYMMDD.shtml`（央视网页面）
- 输出：`news/YYYYMMDD.md`（每日全文）+ `news/catalogue.json`（`[{date, abstract}]` 索引，新到旧）
- md 格式兼容上游 [DuckBurnIncense/xin-wen-lian-bo](https://github.com/DuckBurnIncense/xin-wen-lian-bo)（致谢：爬虫链路与格式参考该仓库）

## 阅读站（GitHub Pages）

**Pages 配置必须是 main 分支 / root**（Settings → Pages → Deploy from a branch → `main` / `(root)`）。
选错（如 /docs 或 gh-pages 分支）则 `news/` 数据不被发布，站点无法加载内容。

- 零构建：`index.html` + `assets/`（markdown-it 已 vendor，钉 14.1.0），客户端渲染
- 同源拉 `news/*.md`，无 CORS；路由 `#date=YYYYMMDD` 可分享；暗色模式；移动端侧栏抽屉
- 渲染后消毒（剥 script/iframe/on* 属性）——正文来自 CCTV 页面透传 HTML

本地预览（file:// 下 fetch 不工作，必须 http）：

```bash
python3 -m http.server 8931
# 浏览器开 http://localhost:8931
```

## 爬虫

```bash
python3 crawler/crawl.py --date 20261031 --dry-run   # 只抓取校验，不写文件
python3 crawler/crawl.py                              # 抓今天并写盘（当日已存在则跳过）
python3 crawler/crawl.py --date 20261030              # 补指定日期
```

- stdlib only（urllib + 正则），选择器清单（2026-11 实测，CCTV 改版时从这里排查）：
  - day 页：`href="https://tv.cctv.com/YYYY/MM/DD/VIDE\w+.shtml"`（文档顺序去重；第 1 条 = 本期导读页，其余 = 新闻详情页）
  - 导读页：`div.nrjianjie_shadow` 内 `<p>` = 完整"本期节目主要内容"
  - 详情页：`div.tit`（第 1 个，去 `[视频]` 前缀）= 标题；`#content_area` innerHTML = 正文
- 校验门（写盘前全过，否则退出码 3）：条目数 ≥10、空正文占比 ≤30%、摘要非空
- 退出码：`0` 成功/幂等跳过，`1` 未预期异常，`2` 当日未发布（day 页 404），`3` 校验失败

## Actions

`update.yml`：东八区 20:35 首跑 + 22:00 幂等补跑；也支持 workflow_dispatch 指定 `date` 补历史。

- 退出码 2（当日未发布）容忍不告警——正常延迟，下一轮自动补
- 失败（退出码 1/3）→ 去重开/评论 issue（label `crawl-failed`）
- 每日 bot commit 即仓库活跃，不触发 GitHub "60 天不活跃禁用 schedule" 策略

## 作为数据源被引用

```
L1 https://raw.githubusercontent.com/thinkycx/xwlb/main/news/<date>.md
L2 https://cdn.jsdelivr.net/gh/thinkycx/xwlb@main/news/<date>.md   # CDN 缓存约 12h
L3 上游 https://raw.githubusercontent.com/DuckBurnIncense/xin-wen-lian-bo/master/news/<date>.md（历史日期兜底）
```

本仓库须保持 **public**（Pages / raw / jsdelivr 依赖公开性）。
