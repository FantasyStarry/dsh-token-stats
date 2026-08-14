"""实时活动 UI 验证（v0.7.0）：
通过路由拦截 /token-stats/summary 注入 activity（总量用轻量假数据 + 可控活动状态），
验证：工作中表情（小电脑/脉冲点）→ 子代理完成提示（✅ 任务完成 + 光环）→
收工提示（💤）→ 空闲休息表情。
"""
import asyncio
import json
import time

from playwright.async_api import async_playwright

PET = "button[aria-label*='查看今日 token 用量']"

LIGHT_TOTAL = {
    "requests": 42,
    "inputTokens": 50000,
    "cacheReadTokens": 20000,
    "cacheWriteTokens": 0,
    "outputTokens": 12000,
    "reasoningTokens": 0,
}


async def main():
    state = {"mode": "idle", "completions": []}

    async def mock_summary(route):
        now_ms = int(time.time() * 1000)
        payload = {
            "day": time.strftime("%Y-%m-%d"),
            "total": LIGHT_TOTAL,
            "providers": {},
            "activity": {
                "lastAt": now_ms if state["mode"] == "working" else now_ms - 60000,
                "completions": state["completions"],
            },
        }
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        await page.route("**/token-stats/summary**", mock_summary)
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
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
                await page.wait_for_timeout(400)
            return False

        async def wait_text(needle, timeout_ms=8000):
            end = asyncio.get_event_loop().time() + timeout_ms / 1000
            while asyncio.get_event_loop().time() < end:
                texts = await page.evaluate(
                    "() => [...document.querySelectorAll('div')].map(d => (d.innerText || ''))"
                )
                if any(needle in t for t in texts):
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

        # ── 阶段 A：工作中 + 子代理完成（每次轮询都是"新鲜"完成，提示持续可见） ──
        state["mode"] = "working"
        state["completions"] = [{
            "at": int(time.time() * 1000),
            "sessionId": "session-abc12345",
            "subagent": True,
            "billedInput": 123456,
            "outputTokens": 4567,
        }]
        report("工作中：出现小电脑（工作脸）", await wait_svg("ts-pet-laptop"))
        report("子代理完成提示（✅ 任务完成 + 子代理 + 输入）",
               await wait_text("任务完成") and await wait_text("子代理") and await wait_text("输入"))
        report("完成时扩散光环（.dts-ring）", await wait_class("dts-ring"))
        report("工作中：右上角脉冲点（.dts-pulse）", await wait_class("dts-pulse"))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-working.png")
        # 悬停气泡：正在干活
        await page.locator(PET).hover()
        await page.wait_for_timeout(700)
        bubbles = await page.evaluate(
            "() => [...document.querySelectorAll('div')].map(d => (d.innerText || '').trim()).filter(t => t.includes('正在干活'))"
        )
        report("悬停气泡显示「正在干活」", len(bubbles) >= 1, str(bubbles[:1]))
        await page.mouse.move(10, 10)

        # ── 阶段 B：空闲 → 收工提示 → 休息表情 ─────────────────────────────
        state["mode"] = "idle"
        state["completions"] = []
        report("收工提示（💤 收工啦）", await wait_text("收工啦", 10000))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-rest-toast.png")
        await page.wait_for_timeout(5000)  # 等 toast 消失
        report("空闲：小电脑消失", not await wait_svg("ts-pet-laptop", 3000))
        report("空闲：脉冲点消失", not await wait_class("dts-pulse", True, 3000))
        report("空闲：休息表情（腮红）", await wait_svg("255, 110, 130"))
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-pet-rest.png")

        report("无页面错误", len(errors) == 0, "; ".join(errors))
        print(f"\n=== {'全部通过' if ok else '存在失败'} ===")
        await browser.close()


asyncio.run(main())
