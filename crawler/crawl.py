#!/usr/bin/env python3
"""新闻联播文字稿爬虫 — 央视网 tv.cctv.com → news/YYYYMMDD.md + catalogue.json

链路（选择器 2026-11 实测）：
  1. day 页 https://tv.cctv.com/lm/xwlb/day/YYYYMMDD.shtml
     → 文档顺序提取去重 VIDE 链接；第 1 条 = 本期导读页，其余 = 新闻详情页
  2. 导读页 div.nrjianjie_shadow 内 <p> = 完整"本期节目主要内容"摘要
  3. 详情页 div.tit（第 1 个，去 [视频] 前缀）= 标题；#content_area innerHTML = 正文（纯 <p>）

退出码：
  0  成功或幂等跳过（当日文件已存在）
  1  未预期异常（网络 3 次重试仍失败、文件 IO 等）
  2  当日稿件未发布（day 页 404 或无 VIDE 链接）
  3  内容校验失败（大概率 CCTV 改版，最需人工介入）

只依赖 stdlib。md 输出格式沿用上游 DuckBurnIncense/xin-wen-lian-bo 以保持兼容。
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

DAY_URL = "https://tv.cctv.com/lm/xwlb/day/{date}.shtml"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.0.0",
    "Accept": "text/html, */*; q=0.9",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://tv.cctv.com/lm/xwlb/",
}

LINK_RE = re.compile(r'href="(https://tv\.cctv\.com/\d{4}/\d{2}/\d{2}/VIDE\w+\.shtml)"')
TIT_RE = re.compile(r'<div class="tit"[^>]*>(.*?)</div>', re.S)
CONTENT_RE = re.compile(r'<div[^>]*id="content_area"[^>]*>(.*?)</div>', re.S)
ABSTRACT_RE = re.compile(r'nrjianjie_shadow.*?<p[^>]*>(.*?)</p>', re.S)
TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_RE = re.compile(r"<script.*?</script>|<iframe.*?</iframe>|<iframe[^>]*/>", re.S | re.I)


def fetch(url, retries=3, timeout=15):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="strict")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise  # 当日未发布，不重试
            if i == retries - 1:
                raise
            time.sleep(2 ** i)
        except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as e:
            if i == retries - 1:
                raise
            time.sleep(2 ** i)


def strip_tags(s):
    return TAG_RE.sub("", s).strip()


def get_links(day_page):
    links = []
    for m in LINK_RE.finditer(day_page):
        if m.group(1) not in links:
            links.append(m.group(1))
    return links


def parse_detail(page):
    """返回 (title, content)；title 为空视为该条失败。"""
    tit = TIT_RE.search(page)
    title = strip_tags(html.unescape(tit.group(1))).removeprefix("[视频]") if tit else ""
    content_m = CONTENT_RE.search(page)
    content = ""
    if content_m:
        # 先剥 script/iframe 再 unescape 实体（&ldquo; 等），保证喂给 LLM 的是可读文本
        content = html.unescape(SCRIPT_RE.sub("", content_m.group(1))).strip()
    return title, content


def parse_abstract(page):
    m = ABSTRACT_RE.search(page)
    if not m:
        return ""
    text = html.unescape(m.group(1))
    # 沿用上游格式：分号/冒号后断行
    return text.replace("；", "；\n\n").replace("：", "：\n\n").strip()


def build_md(date, abstract, news):
    parts = [f"# 《新闻联播》 ({date})", "", "## 新闻摘要", "", abstract, "", "## 详细新闻", ""]
    for title, content, link in news:
        parts.append(f"### {title}\n\n{content}\n\n[查看原文]({link})\n\n")
    return "\n".join(parts) + "\n"


def atomic_write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD，缺省 = 北京时间今天")
    ap.add_argument("--dry-run", action="store_true", help="只抓取校验，不写文件")
    ap.add_argument("--min-items", type=int, default=10, help="最少新闻条数（校验门）")
    ap.add_argument("--repo-root", default=None, help="仓库根目录（缺省 = 脚本上级目录）")
    args = ap.parse_args()

    if not args.date:
        args.date = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")
    if not re.fullmatch(r"\d{8}", args.date):
        print(f"错误：--date 应为 YYYYMMDD，收到 {args.date}", file=sys.stderr)
        sys.exit(1)

    root = args.repo_root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    md_path = os.path.join(root, "news", args.date + ".md")
    catalogue_path = os.path.join(root, "news", "catalogue.json")

    if not args.dry_run and os.path.exists(md_path):
        print(f"already exists, skip: {md_path}")
        sys.exit(0)

    # --- 抓取 day 页 ---
    try:
        day_page = fetch(DAY_URL.format(date=args.date))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"当日稿件未发布（day 页 404）：{args.date}", file=sys.stderr)
            sys.exit(2)
        print(f"day 页抓取失败：{e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"day 页抓取失败：{e}", file=sys.stderr)
        sys.exit(1)

    links = get_links(day_page)
    if len(links) < 2:  # 导读页 + 至少 1 条新闻
        print(f"当日稿件未发布（day 页仅 {len(links)} 条链接）：{args.date}", file=sys.stderr)
        sys.exit(2)

    abstract_link, news_links = links[0], links[1:]

    # --- 摘要（导读页） ---
    try:
        abstract = parse_abstract(fetch(abstract_link))
    except Exception as e:
        print(f"导读页抓取失败：{e}", file=sys.stderr)
        sys.exit(1)

    # --- 逐条新闻 ---
    news, failures = [], 0
    for link in news_links:
        try:
            title, content = parse_detail(fetch(link))
        except Exception as e:
            print(f"警告：详情页失败 {link}: {e}", file=sys.stderr)
            title, content = "", ""
            failures += 1
        if title:
            news.append((title, content, link))
        else:
            failures += 1

    # --- 校验门 ---
    problems = []
    if len(news) < args.min_items:
        problems.append(f"条目数 {len(news)} < {args.min_items}")
    empty_ratio = (len(news) - sum(1 for _, c, _ in news if c)) / max(len(news), 1)
    if empty_ratio > 0.30:
        problems.append(f"空正文占比 {empty_ratio:.0%} > 30%")
    if not abstract:
        problems.append("摘要为空")
    elif "主要内容" not in abstract and "本期节目" not in abstract:
        print("警告：摘要措辞与以往不同（可能 CCTV 改版）", file=sys.stderr)
    if problems:
        print("内容校验失败：" + "；".join(problems), file=sys.stderr)
        sys.exit(3)

    md = build_md(args.date, abstract, news)

    if args.dry_run:
        print(f"[dry-run] date={args.date} 条目数={len(news)} 失败={failures} 摘要={len(abstract)}字")
        print(f"[dry-run] 首条: {news[0][0]}")
        print(f"[dry-run] 末条: {news[-1][0]}")
        sys.exit(0)

    # --- 原子写盘（md 与 catalogue 同成败：全部校验通过后才写） ---
    os.makedirs(os.path.dirname(md_path), exist_ok=True)
    atomic_write(md_path, md)
    catalogue = []
    if os.path.exists(catalogue_path):
        try:
            with open(catalogue_path, encoding="utf-8") as f:
                catalogue = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"警告：catalogue.json 读取失败，视为空重建：{e}", file=sys.stderr)
    if any(c.get("date") == args.date for c in catalogue):
        catalogue = [c for c in catalogue if c.get("date") != args.date]
    catalogue.insert(0, {"date": args.date, "abstract": abstract})
    atomic_write(catalogue_path, json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n")

    print(f"✓ {md_path}（{len(news)} 条，失败 {failures}）")
    print(f"✓ {catalogue_path}（共 {len(catalogue)} 天）")


if __name__ == "__main__":
    main()
