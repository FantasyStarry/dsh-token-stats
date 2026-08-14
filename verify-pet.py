"""用量宠物 UI 验证（v0.6.0）：
- 宠物悬浮在右下角（shell.overlay），SVG 史莱姆存在
- 情绪与今日数据一致（sleepy/happy/busy/dizzy 的表情标记）
- 悬停出现气泡、点击弹出今日用量面板（数字 + 7 天柱状图）
- 拖拽移动并持久化 localStorage；侧边栏开关可隐藏/显示
"""
import asyncio
import json
import urllib.request

from playwright.async_api import async_playwright

PET_LABEL = "查看今日 token 用量（点击展开，拖拽可移动）"


def expected_mood():
    """从真实 /token-stats/summary 计算应显示的宠物情绪。"""
    with urllib.request.urlopen("http://127.0.0.1:3080/token-stats/summary") as r:
        data = json.load(r)
    t = data["total"]
    billed = t["inputTokens"] + t["cacheReadTokens"] + t["cacheWriteTokens"]
    if t["requests"] <= 0:
        return "sleepy", billed
    if billed >= 300000:
        return "dizzy", billed
    if billed >= 100000:
        return "busy", billed
    return "happy", billed


async def main():
    mood, billed = expected_mood()
    print(f"expected mood: {mood} (billed input {billed})")
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)

        ok = True

        def report(name, cond, extra=""):
            nonlocal ok
            ok = ok and cond
            print(f"{'PASS' if cond else 'FAIL'}  {name}{'  (' + extra + ')' if extra else ''}")

        pet = page.locator(f"button[aria-label='{PET_LABEL}']")
        report("宠物按钮存在", await pet.count() == 1, str(await pet.count()))
        report("宠物含 SVG 史莱姆", await pet.locator("svg").count() == 1)
        box = await pet.bounding_box()
        report("宠物在右下角区域", bool(box) and box["x"] > 1000 and box["y"] > 800, str(box))

        # 情绪标记：dizzy → ★；busy → 汗滴；sleepy → z；happy → 腮红椭圆
        svg_html = await pet.locator("svg").inner_html()
        marker = {
            "sleepy": "ts-pet-zzz" in svg_html and ">z<" in svg_html,
            "busy": "ts-pet-sweat" in svg_html,
            "dizzy": "★" in svg_html,
            "happy": "255, 110, 130" in svg_html,
        }
        report(f"情绪标记与数据一致（{mood}）", marker.get(mood, False), str({k: v for k, v in marker.items() if v}))

        # 悬停 → 气泡
        await pet.hover()
        await page.wait_for_timeout(700)
        bubbles = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.includes('token') && t.length < 60)"
        )
        report("悬停出现气泡", len(bubbles) >= 1, str(bubbles[:2]))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-hover.png")

        # 点击 → 面板
        await pet.click()
        await page.wait_for_timeout(900)
        pop = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.startsWith('今日用量'))"
        )
        report("点击弹出今日用量面板", len(pop) >= 1, str(pop[:1]))
        bars = await page.evaluate(
            "() => [...document.querySelectorAll('div')].filter(d => { const s = getComputedStyle(d); return s.width === '9px' && s.borderRadius === '2px 2px 0px 0px'; }).length"
        )
        report("面板含 7 天柱状图（14 根柱子）", bars == 14, str(bars))
        captions = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.includes('完整明细见'))"
        )
        report("面板含设置页指引", len(captions) >= 1, str(captions[:1]))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-open.png")

        # Escape 关闭
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)
        report("Escape 关闭面板", len(await page.evaluate("() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.startsWith('今日用量'))")) == 0)

        # 拖拽移动（左上 160x120）
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx - 160, cy - 120, steps=12)
        await page.mouse.up()
        await page.wait_for_timeout(500)
        box2 = await pet.bounding_box()
        moved = bool(box2) and abs(box2["x"] - (box["x"] - 160)) < 8 and abs(box2["y"] - (box["y"] - 120)) < 8
        report("拖拽后位置移动", moved, str(box2))
        stored = await page.evaluate("() => localStorage.getItem('dsh-token-stats.pet.pos')")
        report("位置已持久化 localStorage", bool(stored), str(stored))

        # 侧边栏开关：隐藏 → 显示
        toggle = page.locator("button", has_text="隐藏宠物")
        report("侧边栏开关存在", await toggle.count() == 1)
        await toggle.click()
        await page.wait_for_timeout(500)
        report("点击后宠物隐藏", await pet.count() == 0)
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-hidden.png")
        show = page.locator("button", has_text="显示宠物")
        report("开关变为「显示宠物」", await show.count() == 1)
        await show.click()
        await page.wait_for_timeout(500)
        report("再次点击宠物恢复", await pet.count() == 1)

        report("无页面错误", len(errors) == 0, "; ".join(errors))

        # 清理：恢复默认位置（便于下次刷新回到右下角）
        await page.evaluate("() => localStorage.removeItem('dsh-token-stats.pet.pos')")
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet.png")
        print(f"\n=== {'全部通过' if ok else '存在失败'} ===")
        await browser.close()


asyncio.run(main())
