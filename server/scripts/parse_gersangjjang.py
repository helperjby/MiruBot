#!/usr/bin/env python3
"""
gersangjjang.com 퀘스트 페이지 파서 (일회성).

/quest/index.asp 에 나열된 서브카테고리를 순회하며 각 상세 페이지를 파싱해
거상봇이 로컬에서 읽을 quests.json 번들을 생성한다.

- '일일-일반' (/quest/date.asp) 은 사용자 지시에 따라 제외.
- 파서는 두 가지 구조를 처리한다:
    1) step-row 구조: div.container > (main-title, npc-group-header*, step-row*)
       — 주간/일일/이벤트/지역 퀘스트 대부분이 이 형태.
    2) 폴백: step-row 가 없는 페이지는 본문 텍스트를 raw_text 로 보존.
- 보상(오래된동전/경험치/신용도/상단기여도/아이템) 은 구조화된 필드로 분리.

사용법
    python3 server/scripts/parse_gersangjjang.py

산출물
    bots/거상봇/gameinfo/quests.json
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

# ── 설정 ──────────────────────────────────────────────
BASE_URL = "https://www.gersangjjang.com"
INDEX_URL = f"{BASE_URL}/quest/index.asp"
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Mobile Safari/537.36"
)
REQUEST_DELAY = 0.5  # 요청 간 간격(초)
REQUEST_TIMEOUT = 15

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUTPUT_PATH = os.path.join(REPO_ROOT, "bots", "거상봇", "quests.json")

KST = timezone(timedelta(hours=9))

# 사용자 지시: '일일-일반' 은 파싱 대상에서 제외
EXCLUDED_LABELS = {"일일-일반"}

# alias: 봇의 축약 명령어 → 정식 라벨
ALIASES = {
    "주간": "주간-일반",
    "일일": "일일-우호도",
}

# href slug → 카테고리 분류 (1차 제안)
# /quest/index.asp DOM 순서를 기준으로 6분류.
CATEGORY_BY_SLUG = {
    # 진행
    "xunlian2": "진행", "xunlian": "진행", "shangye": "진행", "zhandou": "진행",
    "xiong": "진행", "4jie": "진행", "gaizao": "진행", "zhuanzhi": "진행",
    "zhujue2": "진행", "drive": "진행", "xiulian": "진행",
    # 주간일일
    "date2": "주간일일", "week": "주간일일", "week2": "주간일일",
    # shangtuan/quest 는 slug 처리가 다름 → 별도 처리
    # 전장
    "wudaochang": "전장", "wudao2": "전장", "wudao3": "전장", "wudao4": "전장",
    "keju": "전장", "shuxing": "전장", "zhumak": "전장", "tobel2": "전장",
    # 이벤트
    "wanshengjie": "이벤트", "nolbu": "이벤트", "imjin": "이벤트",
    "chunjie": "이벤트", "shenye": "이벤트", "baozhu": "이벤트",
    # 서비스
    "huan": "서비스", "zhuan": "서비스", "tilian": "서비스", "zhizao": "서비스",
}

# 숫자 단위 파싱 맵
NUMBER_UNITS = {"만": 10_000, "천": 1_000, "억": 100_000_000}


# ── 유틸 ──────────────────────────────────────────────
def http_get(url: str) -> str | None:
    """HTML 을 문자열로 반환. 실패 시 None."""
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            print(f"[parse] HTTP {resp.status_code}: {url}", file=sys.stderr)
            return None
        # euc-kr 페이지가 있을 수 있으니 apparent_encoding 활용
        if resp.encoding is None or resp.encoding.lower() == "iso-8859-1":
            resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text
    except Exception as e:
        print(f"[parse] 요청 오류 {url}: {e}", file=sys.stderr)
        return None


def slug_of(href: str) -> str:
    """'/quest/week.asp' → 'week'  ,  '/shangtuan/quest.asp' → 'shangtuan_quest'"""
    path = href.strip("/").replace(".asp", "")
    return path.replace("/", "_")


def parse_number_with_unit(num_str: str, unit: str | None) -> int:
    """'1,234' + '만' → 12,340,000"""
    try:
        num = float(num_str.replace(",", ""))
    except ValueError:
        return 0
    if unit and unit in NUMBER_UNITS:
        num *= NUMBER_UNITS[unit]
    return int(num)


def _parse_korean_number(s: str) -> int:
    """복합 한국어 숫자 파싱: 2천만, 1억3757만, 17만4000, 645만, 2400 등."""
    s = s.replace(",", "").replace(" ", "").strip()
    if not s:
        return 0

    total = 0

    # 억
    m = re.match(r"([\d.]+)억(.*)$", s)
    if m:
        total += int(float(m.group(1)) * 100_000_000)
        s = m.group(2)

    # 천만 (2천만 = 2000만) 또는 만
    m = re.match(r"([\d.]+)(천)?만(.*)$", s)
    if m:
        v = float(m.group(1))
        if m.group(2):  # 천 접미: "2천만" = 2000만
            v *= 1000
        total += int(v * 10_000)
        s = m.group(3)

    # 천
    m = re.match(r"([\d.]+)천(.*)$", s)
    if m:
        total += int(float(m.group(1)) * 1_000)
        s = m.group(2)

    # 남은 숫자
    if s and re.match(r"^[\d.]+$", s.strip()):
        total += int(float(s.strip()))

    if total == 0:
        try:
            return int(float(s.strip() if s else "0"))
        except ValueError:
            return 0
    return total


# ── 허브 파싱 ─────────────────────────────────────────
def parse_index(html: str) -> list[tuple[str, str]]:
    """/quest/index.asp 에서 (label, href) 쌍 추출."""
    soup = BeautifulSoup(html, "html.parser")
    results: list[tuple[str, str]] = []
    seen: set[str] = set()

    for a in soup.find_all("a"):
        href = a.get("href", "")
        if not href:
            continue
        # 상대 경로 정규화
        if href.startswith("./"):
            href = href[1:]
        if not href.startswith("/"):
            # 상대경로면 /quest/ 로 가정 (이 페이지 기준)
            if href.endswith(".asp"):
                href = "/quest/" + href
            else:
                continue

        if not href.endswith(".asp"):
            continue
        # index 자신 제외
        if href in ("/quest/index.asp",):
            continue
        # /quest/*.asp 또는 /shangtuan/quest.asp 만 대상
        if not (href.startswith("/quest/") or href == "/shangtuan/quest.asp"):
            continue
        if href in seen:
            continue

        label = a.get_text(strip=True)
        if not label:
            continue

        seen.add(href)
        results.append((label, href))

    return results


# ── 상세 파싱 ─────────────────────────────────────────
def _cell_text_preserving_br(cell: Tag) -> str:
    """셀의 <br> 을 개행으로 보존한 텍스트 추출."""
    parts: list[str] = []
    for node in cell.descendants:
        if isinstance(node, NavigableString):
            parts.append(str(node))
        elif isinstance(node, Tag) and node.name == "br":
            parts.append("\n")
    text = "".join(parts)
    # 연속 공백 정리 (개행은 유지)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    return "\n".join([ln for ln in lines if ln])


def _parse_rewards(desc_raw: str) -> dict:
    """w-desc 원본 문자열에서 보상을 구조화."""
    coin = 0
    exp = 0
    credit = 0
    contrib = 0
    favor = 0
    favor_name = ""
    items: list[str] = []

    for line in desc_raw.split("\n"):
        line = line.strip()
        if not line:
            continue

        m = re.match(r"^오래된\s*동전\s*\+?\s*([\d,]+)\s*개?", line)
        if m:
            coin += parse_number_with_unit(m.group(1), None)
            continue

        m = re.match(r"^(?:전투\s*)?경험치\s*\+?\s*([\d,.]+)\s*(만|천|억)?", line)
        if m:
            exp += parse_number_with_unit(m.group(1), m.group(2))
            continue

        m = re.match(r"^신용도\s*\+?\s*([\d,.]+)\s*(만|천|억)?", line)
        if m:
            credit += parse_number_with_unit(m.group(1), m.group(2))
            continue

        m = re.match(r"^상단\s*기여도\s*\+?\s*([\d,]+)", line)
        if m:
            contrib += parse_number_with_unit(m.group(1), None)
            continue

        m = re.match(r"^(.+우호도)\s*\+?\s*([\d,]+)", line)
        if m:
            favor += parse_number_with_unit(m.group(2), None)
            if not favor_name:
                favor_name = m.group(1).strip()
            continue

        # 나머지는 아이템/기타 문구로 취급
        items.append(line)

    return {
        "coin": coin,
        "exp": exp,
        "credit": credit,
        "contrib": contrib,
        "favor": favor,
        "favor_name": favor_name,
        "items": items,
    }


def _parse_top_desc(text: str | None) -> dict:
    """top_desc 원본 문자열을 npcs, summary, required_items 로 구조 분리.

    반환값:
        {
            "npcs": [{"name": "...", "location": "..."}],
            "summary": {"exp": int, "credit": int, "contrib": int,
                        "favor": int, "favor_name": str, "coin_label": str, "coin_count": int},
            "required_items": [["아이템1", "아이템2"], ...],  # 세미콜론 그룹 단위
            "dungeon_note": str | None,
        }
    """
    empty: dict = {
        "npcs": [],
        "summary": {},
        "required_items": [],
        "dungeon_note": None,
    }
    if not text:
        return empty

    # ── 1) 섹션 분리: NPC부 / 통계부 / 필요물품부 ──
    # 통계 시작점: '총경험치' 또는 '총신용도' 등
    stat_start = None
    for kw in ("총경험치", "총신용도", "총상단기여도", "상단기여도"):
        idx = text.find(kw)
        if idx != -1 and (stat_start is None or idx < stat_start):
            stat_start = idx

    # 필요물품 시작점
    req_start = None
    for kw in ("필요 물품", "필요물품"):
        idx = text.find(kw)
        if idx != -1 and (req_start is None or idx < req_start):
            req_start = idx

    if stat_start is None:
        # 통계 블록 없음 → 구조화 불가, 원본 그대로
        return empty

    npc_part = text[:stat_start].strip()
    if req_start is not None and req_start > stat_start:
        stat_part = text[stat_start:req_start].strip()
        req_part = text[req_start:].strip()
    else:
        stat_part = text[stat_start:].strip()
        req_part = ""

    # ── 2) NPC 파싱 ──
    npcs: list[dict] = []
    npc_lines = [ln.strip() for ln in npc_part.split("\n") if ln.strip()]
    i = 0
    while i < len(npc_lines):
        name = npc_lines[i]
        location = ""
        # 같은 줄에 괄호 위치가 있는 경우: "태환선사 (한단 아래)"
        m = re.match(r"^(.+?)\s*[（(](.+?)[）)]$", name)
        if m:
            name = m.group(1).strip()
            location = m.group(2).strip()
        elif i + 1 < len(npc_lines):
            next_ln = npc_lines[i + 1]
            m2 = re.match(r"^[（(](.+?)[）)]$", next_ln)
            if m2:
                location = m2.group(1).strip()
                i += 1
        npcs.append({"name": name, "location": location})
        i += 1

    # ── 3) 통계 파싱 ──
    # 줄바꿈을 공백으로 합쳐서 한 줄로 만든 뒤 정규식 적용
    stat_flat = re.sub(r"\s+", " ", stat_part)
    summary: dict = {}

    # 복합 한국어 숫자 캡처 패턴 (645만, 2천만, 17만4000, 1억3757만 등)
    # lookahead로 단위 뒤에 숫자·단위·구두점만 허용 (천년호 등 오매칭 방지)
    _KN = r"([\d,.]+(?:\s*[억만천](?=[\s\d,.억만천,]|$)\s*[\d,.]*)*)"

    m = re.search(r"총경험치\s*:?\s*\+?\s*" + _KN, stat_flat)
    if m:
        summary["exp"] = _parse_korean_number(m.group(1))

    m = re.search(r"총신용도\s*:?\s*\+?\s*" + _KN, stat_flat)
    if m:
        summary["credit"] = _parse_korean_number(m.group(1))

    m = re.search(
        r"(?:총상단기여도|상단\s*기여도\s*총|상단기여도)\s*:?\s*\+?\s*" + _KN,
        stat_flat,
    )
    if m:
        summary["contrib"] = _parse_korean_number(m.group(1))

    m = re.search(r"(\S+우호도)\s*:?\s*\+?\s*" + _KN, stat_flat)
    if m:
        summary["favor_name"] = m.group(1).strip()
        summary["favor"] = _parse_korean_number(m.group(2))

    m = re.search(r"물물교환동전\s*:?\s*\+?\s*([\d,]+)\s*개?", stat_flat)
    if m:
        summary["coin_label"] = "물물교환동전"
        summary["coin_count"] = _parse_korean_number(m.group(1))

    # 던전명: 원본 줄 중 통계 키워드가 없고 숫자/구두점만이 아닌 줄
    _STAT_KW = re.compile(
        r"총경험치|총신용도|총상단기여도|상단\s*기여도|우호도|물물교환동전"
    )
    _NUM_ONLY = re.compile(r"^[\d,.\s+:만천억개]*$")
    dungeon_lines = []
    for ln in stat_part.split("\n"):
        ln = ln.strip().strip(",").strip()
        if not ln:
            continue
        if _STAT_KW.search(ln):
            continue
        if _NUM_ONLY.match(ln):
            continue
        dungeon_lines.append(ln)
    if dungeon_lines:
        summary["dungeon_note"] = " ".join(dungeon_lines)

    # ── 4) 필요 물품 파싱 ──
    required_items: list[list[str]] = []
    if req_part:
        # "필요 물품\n:\n..." 또는 "필요물품: ..."
        req_body = re.sub(r"^필요\s*물품\s*:?\s*", "", req_part).strip()
        # 세미콜론으로 그룹 분리, 각 그룹 내 콤마로 아이템 분리
        groups = re.split(r"[;\n]+", req_body)
        for g in groups:
            items_in_group = [
                it.strip() for it in re.split(r"[,，]", g) if it.strip()
            ]
            if items_in_group:
                required_items.append(items_in_group)

    return {
        "npcs": npcs,
        "summary": summary,
        "required_items": required_items,
    }


def _parse_step_row_container(container: Tag) -> dict:
    """div.container 하나를 {title, top_desc, groups: [...]} 로 변환."""
    main_title_el = container.select_one("div.main-title")
    top_desc_el = container.select_one("div.top-desc")
    title = (
        main_title_el.get_text(" ", strip=True) if main_title_el else None
    )
    top_desc = (
        top_desc_el.get_text("\n", strip=True) if top_desc_el else None
    )

    groups: list[dict] = []
    current: dict | None = None

    def flush():
        nonlocal current
        if current is not None and (current["header"] or current["steps"]):
            groups.append(current)
        current = None

    for el in container.children:
        if not isinstance(el, Tag):
            continue
        classes = el.get("class") or []

        if "npc-group-header" in classes:
            flush()
            current = {
                "header": el.get_text(" ", strip=True),
                "steps": [],
            }
        elif "step-row" in classes:
            if current is None:
                # 그룹 헤더 없이 바로 step-row (예: shangtuan/quest)
                current = {"header": None, "steps": []}

            step_cell = el.select_one(".w-step")
            mon_cell = el.select_one(".w-monster")
            desc_cell = el.select_one(".w-desc")

            step_text = (
                step_cell.get_text(" ", strip=True) if step_cell else ""
            )
            mon_text = (
                _cell_text_preserving_br(mon_cell) if mon_cell else ""
            )
            desc_text = (
                _cell_text_preserving_br(desc_cell) if desc_cell else ""
            )

            current["steps"].append({
                "step": step_text,
                "monster": mon_text,
                "desc_raw": desc_text,
                "rewards": _parse_rewards(desc_text),
            })

    flush()

    parsed_top = _parse_top_desc(top_desc)

    return {
        "title": title,
        "top_desc": top_desc,
        "npcs": parsed_top["npcs"],
        "summary": parsed_top["summary"],
        "required_items": parsed_top["required_items"],
        "groups": groups,
    }


def parse_detail(html: str, url: str) -> dict:
    """상세 페이지 HTML → 스키마화된 dict."""
    soup = BeautifulSoup(html, "html.parser")
    containers = soup.select("div.container")

    step_row_total = sum(len(c.select("div.step-row")) for c in containers)

    if step_row_total == 0:
        # 폴백: step-row 구조가 없으면 본문 텍스트만 보존
        return _fallback_parse(soup, url)

    parsed_containers: list[dict] = []
    for c in containers:
        if not c.select("div.step-row"):
            continue  # 콘텐츠 없는 container 스킵
        parsed_containers.append(_parse_step_row_container(c))

    return {
        "format": "step-row",
        "url": url,
        "containers": parsed_containers,
    }


def _fallback_parse(soup: BeautifulSoup, url: str) -> dict:
    """step-row 가 아닌 페이지: 본문 텍스트를 보존.

    구형 페이지(교환/제련/강화/특별제작 등)는 <table> 기반이며
    상단/사이드에 네비게이션 테이블이 섞여 있다. 문자 길이가 가장 큰
    테이블을 본문으로 간주하고, 나머지 네비게이션은 제외한다.
    """
    for tag in soup(["script", "style", "nav", "header", "footer", "iframe"]):
        tag.decompose()

    # 1순위: 가장 큰 테이블(들) 추출
    tables = soup.select("table")
    table_texts = []
    for t in tables:
        txt = t.get_text("\n", strip=True)
        if len(txt) >= 150:  # 네비게이션/푸터 컷
            table_texts.append(txt)

    if table_texts:
        text = "\n\n".join(table_texts)
    else:
        body = soup.find("body") or soup
        text = body.get_text("\n", strip=True)

    # 공백 라인 정리
    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln]
    text = "\n".join(lines)

    # 너무 길면 컷
    if len(text) > 4000:
        text = text[:4000].rstrip() + "\n... (잘림)"

    return {
        "format": "raw",
        "url": url,
        "raw_text": text,
    }


# ── 메인 ──────────────────────────────────────────────
def run(dry_run: bool = False) -> None:
    print(f"[parse] 인덱스 요청: {INDEX_URL}")
    index_html = http_get(INDEX_URL)
    if index_html is None:
        print("[parse] 인덱스 요청 실패로 종료")
        sys.exit(1)

    entries = parse_index(index_html)
    print(f"[parse] 인덱스에서 {len(entries)}개 서브카테고리 발견")

    # 제외 라벨 처리
    filtered: list[tuple[str, str]] = []
    for label, href in entries:
        if label in EXCLUDED_LABELS:
            print(f"[parse] 제외: {label} ({href})")
            continue
        filtered.append((label, href))

    print(f"[parse] 파싱 대상: {len(filtered)}개\n")

    quests: dict[str, dict] = {}
    categories: dict[str, list[str]] = {
        "진행": [], "지역": [], "주간일일": [],
        "전장": [], "이벤트": [], "서비스": [],
    }
    failures: list[str] = []

    for i, (label, href) in enumerate(filtered, 1):
        url = BASE_URL + href
        slug = slug_of(href)
        # 카테고리 결정 (매핑 없으면 '지역' 으로 fallback — 지역 퀘스트가 가장 많음)
        if slug == "shangtuan_quest":
            category = "주간일일"
        else:
            last = slug.split("_")[-1]
            category = CATEGORY_BY_SLUG.get(last, "지역")

        print(f"[parse] ({i}/{len(filtered)}) {label} → {url} [{category}]")

        html = http_get(url)
        if html is None:
            failures.append(label)
            time.sleep(REQUEST_DELAY)
            continue

        try:
            detail = parse_detail(html, url)
        except Exception as e:
            print(f"[parse] 파싱 오류 ({label}): {e}", file=sys.stderr)
            failures.append(label)
            time.sleep(REQUEST_DELAY)
            continue

        quests[label] = {
            "label": label,
            "category": category,
            "url": url,
            **detail,
        }
        categories[category].append(label)

        time.sleep(REQUEST_DELAY)

    # 빈 카테고리 제거
    categories = {k: v for k, v in categories.items() if v}

    bundle = {
        "generated_at": datetime.now(KST).isoformat(),
        "source": BASE_URL,
        "total": len(quests),
        "categories": categories,
        "aliases": ALIASES,
        "quests": quests,
    }

    print(f"\n[parse] 완료: {len(quests)}개 파싱 성공, {len(failures)}개 실패")
    if failures:
        print(f"[parse] 실패 목록: {failures}")

    if dry_run:
        print("[parse] dry-run 모드: 파일 저장하지 않음")
        return

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
    print(f"[parse] 저장 완료: {OUTPUT_PATH}")
    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"[parse] 파일 크기: {size_kb:.1f} KB")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(dry_run=args.dry_run)
