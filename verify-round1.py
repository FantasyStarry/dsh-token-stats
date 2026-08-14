"""v0.8.0 验证（宠物打磨 + 设置页增强）：
- 宠物：放大 64px、描边/暗影/地面阴影、hover 探头（ts-pet-perk）、双击逗宠物（♥ 爱心 + 开心脸）、
  工作中小电脑进度条动画（ts-pet-prog）、toast 带图标绿边、面板命中率条 + 近 7 天合计
- 设置页：刷新按钮 + 更新于时间、缓存命中率条、图表今日高亮、近 7 天合计、移动端表格横向滚动
"""
import asyncio
import json
import time

from playwright.async_api import async_playwright

PET = "button[aria-label*='查看今日 token 用量']"

PROVIDERS = {
    "opencode-go": {
        "total": {"requests": 990, "inputTokens": 1295289, "cacheReadTokens": 128647552, "cacheWriteTokens": 0, "outputTokens": 789893, "reasoningTokens": 0},
        "models": {
            "deepseek-v4-flash": {"requests": 960, "inputTokens": 1250000, "cacheReadTokens": 124000000, "cacheWriteTokens": 0, "outputTokens": 700000, "reasoningTokens": 0},
            "minimax-m3": {"requests": 30, "inputTokens": 45289, "cacheReadTokens": 4647552, "cacheWriteTokens": 0, "outputTokens": 89893, "reasoningTokens": 0},
        },
    },
    "feimao": {
        "total": {"requests": 2, "inputTokens": 44756, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 3000, "reasoningTokens": 0},
        "models": {
            "gpt-5.6-sol": {"requests": 2, "inputTokens": 44756, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 3000, "reasoningTokens": 0},
        },
    },
}

HISTORY_DAYS = [
    {"day": "2026-08-08", "total": {"requests": 0, "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0, "reasoningTokens": 0}},
    {"day": "2026-08-09", "total": {"requests": 0, "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0, "reasoningTokens": 0}},
    {"day": "2026-08-10", "total": {"requests": 12, "inputTokens": 18000, "cacheReadTokens": 300000, "cacheWriteTokens": 0, "outputTokens": 45000, "reasoningTokens": 0}},
    {"day": "2026-08-11", "total": {"requests": 45, "inputTokens": 60000, "cacheReadTokens": 1200000, "cacheWriteTokens": 0, "outputTokens": 90000, "reasoningTokens": 0}},
    {"day": "2026-08-12", "total": {"requests": 30, "inputTokens": 40000, "cacheReadTokens": 800000, "cacheWriteTokens": 0, "outputTokens": 60000, "reasoningTokens": 0}},
    {"day": "2026-08-13", "total": {"requests": 88, "inputTokens": 120000, "cacheReadTokens": 3000000, "cacheWriteTokens": 0, "outputTokens": 150000, "reasoningTokens": 0}},
    {"day": "2026-08-14", "total": {"requests": 1226, "inputTokens": 1600000, "cacheReadTokens": 150000000, "cacheWriteTokens": 0, "outputTokens": 950000, "reasoningTokens": 0}},
]

SESSIONS = {
    "day": "2026-08-14",
    "sessions": [
        {"id": "session-85f8702d-af8a-4bbf-9187-e80839e0eeb7", "parent": None, "subagent": False, "requests": 196,
         "inputTokens": 172376, "outputTokens": 176449, "cacheReadTokens": 26205440, "cacheWriteTokens": 0, "reasoningTokens": 0, "lastAt": 1786678643614},
        {"id": "0d9d461f-064c-49e0-a0be-f87df4ffcf39", "parent": "session-f5b46c67-19ed-46a5-b19c-a81e42e47670", "subagent": True, "requests": 57,
         "inputTokens": 137942, "outputTokens": 23901, "cacheReadTokens": 5273088, "cacheWriteTokens": 0, "reasoningTokens": 0, "lastAt": 1786669789184},
    ],
}


async def main():
    state = {"mode": "idle", "completions": []}

    def total_now():
        t = PROVIDERS["opencode-go"]["total"]
        return {
            "requests": t["requests"] + 1,
            "inputTokens": t["inputTokens"] + 5000,
            "cacheReadTokens": t["cacheReadTokens"] + 118000,
            "cacheWriteTokens": 0,
            "outputTokens": t["outputTokens"] + 4600,
            "reasoningTokens": 0,
        }

    async def mock_summary(route):
        now_ms = int(time.time() * 1000)
        payload = {
            "day": time.strftime("%Y-%m-%d"),
            "total": total_now(),
            "providers": PROVIDERS,
            "activity": {
                "lastAt": now_ms if state["mode"] == "working" else now_ms - 60000,
                "completions": state["completions"],
            },
        }
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    async def mock_history(route):
        await route.fulfill(status=200, content_type="application/json", body=json.dumps({"days": HISTORY_DAYS}))

    async def mock_sessions(route):
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(SESSIONS))

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        await page.route("**/token-stats/summary**", mock_summary)
        await page.route("**/token-stats/history**", mock_history)
        await page.route("**/token-stats/sessions**", mock_sessions)
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        # 清理宠物位置，回到默认右下角
        await page.evaluate("() => localStorage.removeItem('dsh-token-stats.pet.pos')")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(4000)

        ok = True

        def report(name, cond, extra=""):
            nonlocal ok
            ok = ok and cond
            print(f"{'PASS' if cond else 'FAIL'}  {name}{'  (' + extra + ')' if extra else ''}")

        def svg_html():
            return page.evaluate(
                "() => { const b = document.querySelector('button[aria-label*=\"查看今日 token 用量\"]'); return b && b.querySelector('svg') ? b.querySelector('svg').outerHTML : ''; }"
            )

        async def wait_svg(needle, timeout_ms=8000):
            end = asyncio.get_event_loop().time() + timeout_ms / 1000
            while asyncio.get_event_loop().time() < end:
                if needle in await svg_html():
                    return True
                await page.wait_for_timeout(300)
            return False

        async def wait_gone(needle, timeout_ms=8000):
            end = asyncio.get_event_loop().time() + timeout_ms / 1000
            while asyncio.get_event_loop().time() < end:
                if needle not in await svg_html():
                    return True
                await page.wait_for_timeout(300)
            return False

        async def wait_class(cls, present=True, timeout_ms=8000):
            end = asyncio.get_event_loop().time() + timeout_ms / 1000
            while asyncio.get_event_loop().time() < end:
                found = await page.evaluate(f"() => !!document.querySelector('.{cls}')")
                if found == present:
                    return True
                await page.wait_for_timeout(300)
            return False

        pet = page.locator(PET)
        report("宠物按钮存在（新 aria-label）", await pet.count() == 1, str(await pet.count()))

        # ── 阶段 1：空闲 + 外观 ──────────────────────────────────────────────
        box = await pet.bounding_box()
        report("宠物尺寸放大到 64px", bool(box) and box["width"] == 64, str(box))
        report("宠物在右下角区域", bool(box) and box["x"] > 1200 and box["y"] > 800, str(box))
        report("地面阴影存在", await page.evaluate("() => !!document.querySelector('.ts-pet-shade')"))
        s = await svg_html()
        report("角色描边（stroke 样式）", "stroke-opacity: 0.16" in s or "strokeOpacity" in s.replace("stroke-opacity", "strokeOpacity"), "")
        report("底部暗影椭圆", 'key="sh"' in s or "ellipse" in s, "")
        report("空闲情绪（今日大用量 → 晕眩双星）", "ts-pet-star2" in s, "")
        report("待机活态：身体浮动 + 眼睛左顾右盼", "pt-float" in s and "pt-lookaround" in s, "")
        report("表情弹入动画类存在", "ts-pet-facepop" in s, "")
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-pet-idle.png")

        # ── 阶段 2：hover 探头 ──────────────────────────────────────────────
        await pet.hover()
        await page.wait_for_timeout(700)
        s = await svg_html()
        report("hover 探头（ts-pet-perk）", "ts-pet-perk" in s, "")
        bubbles = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.includes('token') && t.length < 60)"
        )
        report("hover 气泡出现", len(bubbles) >= 1, str(bubbles[:1]))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-pet-hover.png")

        # ── 阶段 3：双击逗宠物 ──────────────────────────────────────────────
        await pet.dblclick()
        report("双击后出现爱心（ts-pet-heart）", await wait_svg("ts-pet-heart"), "")
        report("爱心内容 ♥", "♥" in await svg_html(), "")
        report("开心脸（腮红）", "255, 110, 130" in await svg_html(), "")
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-pet-poke.png")
        report("爱心自动消失", await wait_gone("ts-pet-heart", 6000), "")

        # ── 阶段 4：点击打开面板 ─────────────────────────────────────────────
        await pet.click()
        await page.wait_for_timeout(900)
        pop_text = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.startsWith('今日用量'))"
        )
        report("面板打开", len(pop_text) >= 1, str(pop_text[:1])[:120])
        joined = " ".join(pop_text)
        report("面板含命中率条", "缓存命中率" in joined and "%" in joined, "")
        report("面板含近 7 天合计", "近 7 天合计" in joined, "")
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-pet-open.png")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)

        # ── 阶段 5：工作中（小电脑 + 进度条动画 + 脉冲点 + 完成 toast） ──────
        state["mode"] = "working"
        state["completions"] = [{
            "at": int(time.time() * 1000),
            "sessionId": "session-abc12345",
            "subagent": True,
            "billedInput": 123456,
            "outputTokens": 4567,
        }]
        report("工作中：小电脑", await wait_svg("ts-pet-laptop"), "")
        report("小电脑进度条动画（ts-pet-prog）", "ts-pet-prog" in await svg_html(), "")
        report("工作态：屏幕光标闪烁 + 加载点", "pt-cursor" in await svg_html() and "pt-load-dot" in await svg_html(), "")
        report("脉冲点", await wait_class("dts-pulse"), "")
        toast_text = await page.evaluate(
            "() => { const t = document.querySelector('.dts-pop'); return t ? t.innerText : ''; }"
        )
        report("完成 toast 内容", "任务完成" in toast_text and "子代理" in toast_text, str(toast_text)[:80])
        report("toast 带图标（小史莱姆）", await page.evaluate("() => !!document.querySelector('.dts-pop svg')"))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-pet-working.png")
        state["mode"] = "idle"
        state["completions"] = []
        await page.wait_for_timeout(6000)

        # ── 阶段 6：设置页（桌面） ───────────────────────────────────────────
        # 注意：text=设置 是子串匹配，会先命中"我现在在这个设置页面的时候还…"这类标题，
        # 必须用精确匹配
        await page.get_by_text("设置", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(3000)
        await page.get_by_text("用量统计", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(2500)
        report("刷新按钮存在", await page.locator("button[aria-label='刷新统计']").count() == 1)
        report("更新时间文本", await page.locator("text=更新于").count() >= 1)
        report("命中率条（dts-hit）", await page.evaluate("() => !!document.querySelector('.dts-hit-track .dts-hit-fill')"))
        report("提供商汇总 chips", await page.evaluate("() => document.querySelectorAll('.dts-provider-chip').length >= 1"))
        report("零值日基线圆点（dts-chart-dot）", await page.evaluate("() => !!document.querySelector('.dts-chart-dot')"))
        report("30 天折叠小节存在", await page.evaluate("() => !!document.querySelector('.dts-section-heading-toggle')"))
        report("30 天小节可展开（含近 30 天合计）", await page.evaluate(
            "() => { const t = document.querySelector('.dts-section-heading-toggle'); return t && t.textContent.includes('近 30 天'); }"
        ))
        report("近 7 天合计（标题注记）", await page.evaluate(
            "() => [...document.querySelectorAll('.dts-section-heading small')].some(s => s.textContent.includes('近 7 天合计'))"
        ))
        report("今日柱状图高亮（最后一天加粗）", await page.evaluate(
            "() => { const els = [...document.querySelectorAll('.dts-chart-label')]; const last = els[els.length - 1]; return last && getComputedStyle(last).fontWeight === '700'; }"
        ))
        # 滚动对话框内容到底部，截取"最近 7 天"图表区
        await page.mouse.move(800, 500)
        await page.mouse.wheel(0, 900)
        await page.wait_for_timeout(600)
        report("滚动后图表可见（dts-chart）", await page.evaluate("() => !!document.querySelector('.dts-chart')"))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-settings-desktop-chart.png")
        await page.mouse.wheel(0, -900)
        await page.wait_for_timeout(400)
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-settings-desktop.png", full_page=True)

        # ── 阶段 7：设置页（移动端） ─────────────────────────────────────────
        await page.set_viewport_size({"width": 720, "height": 900})
        await page.wait_for_timeout(1500)
        scroll_ok = await page.evaluate(
            "() => { const els = [...document.querySelectorAll('.dts-table-scroll')]; return els.length > 0 && els.every(e => getComputedStyle(e).overflowX === 'auto'); }"
        )
        report("移动端表格横向滚动容器", scroll_ok)
        report("移动端隐藏低优先级列（未缓存/推理）", await page.evaluate(
            "() => { const m = document.querySelector('.dts-tbl-model'); const s = document.querySelector('.dts-tbl-session'); if (!m || !s) return false; const mh = m.querySelector('th:nth-child(4)'); const sh = s.querySelector('th:nth-child(3)'); return mh && getComputedStyle(mh).display === 'none' && sh && getComputedStyle(sh).display === 'none'; }"
        ))
        report("移动端指标网格重排（主指标整行）", await page.evaluate(
            "() => { const p = document.querySelector('.dts-primary-metric'); return p && getComputedStyle(p).gridColumn.includes('1 / -1'); }"
        ))
        report("移动端表格无横向溢出（scrollWidth ≤ clientWidth）", await page.evaluate(
            "() => { const m = document.querySelector('.dts-tbl-model'); const s = document.querySelector('.dts-tbl-session'); if (!m || !s) return false; return m.scrollWidth <= m.clientWidth + 2 && s.scrollWidth <= s.clientWidth + 2; }"
        ))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui2-settings-mobile.png", full_page=True)

        report("无页面错误", len(errors) == 0, "; ".join(errors))
        print(f"\n=== {'全部通过' if ok else '存在失败'} ===")
        await browser.close()


asyncio.run(main())
