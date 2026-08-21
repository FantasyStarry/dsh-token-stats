"""v0.10.0 费用 + 官方余额 UI 验证（mock 新服务端响应，无需重启 dsh web）：
- Pass 1：真实旧服务端响应（无 cost 字段）→ 页面无报错、分区正常渲染（向后兼容）
- Pass 2：mock summary/history/balance（带 cost/unpriced/余额）→
  概览「估算费用 ¥15.65」+「1 个模型未计价」+「官方余额 ¥88.50」、
  模型明细「费用」列（¥12.05 / —）、7 天表「费用」列、宠物弹窗「估算费用」、
  无页面错误；截图 docs/verify-cost.png
"""
import asyncio
import json
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3080"

SUMMARY = {
    "day": "2026-08-21",
    "total": {
        "requests": 3,
        "inputTokens": 3000000,
        "cacheReadTokens": 1000000,
        "cacheWriteTokens": 0,
        "outputTokens": 2100000,
        "reasoningTokens": 500000,
        "cost": 15.65,
        "unpriced": 1,
    },
    "providers": {
        "tokenrhythm": {
            "total": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 1000000, "cacheWriteTokens": 0, "outputTokens": 1000000, "reasoningTokens": 500000, "cost": 12.05, "unpriced": 0},
            "models": {
                "deepseek-v4-flash-0731": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 1000000, "cacheWriteTokens": 0, "outputTokens": 1000000, "reasoningTokens": 500000, "cost": 12.05}
            },
        },
        "modlens-maofei": {
            "total": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 100000, "reasoningTokens": 0, "cost": 3.6, "unpriced": 0},
            "models": {
                "DeepSeek-V4-Flash-0731": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 100000, "reasoningTokens": 0, "cost": 3.6}
            },
        },
        "openai": {
            "total": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 1000000, "reasoningTokens": 0, "cost": None, "unpriced": 1},
            "models": {
                "gpt-5.6-luna": {"requests": 1, "inputTokens": 1000000, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 1000000, "reasoningTokens": 0, "cost": None}
            },
        },
    },
    "activity": {"lastAt": 0, "completions": []},
}

HISTORY = {
    "days": [
        {"day": "2026-08-21", "total": {**SUMMARY["total"]}},
        {"day": "2026-08-20", "total": {"requests": 5, "inputTokens": 4000000, "cacheReadTokens": 2000000, "cacheWriteTokens": 0, "outputTokens": 1800000, "reasoningTokens": 0, "cost": 9.75, "unpriced": 0}},
        {"day": "2026-08-19", "total": {"requests": 0, "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0, "reasoningTokens": 0, "cost": None, "unpriced": 0}},
    ]
}

SESSIONS = {"day": "2026-08-21", "sessions": []}

BALANCE = {
    "ok": True,
    "isAvailable": True,
    "currency": "CNY",
    "total": 88.5,
    "infos": [{"currency": "CNY", "total": "88.50", "granted": "0.00", "toppedUp": "88.50"}],
    "fetchedAt": 1787305418410,
}


async def mock_routes(page):
    async def full(route, body):
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    await page.route("**/token-stats/summary**", lambda r: full(r, SUMMARY))
    await page.route("**/token-stats/history**", lambda r: full(r, HISTORY))
    await page.route("**/token-stats/sessions**", lambda r: full(r, SESSIONS))
    await page.route("**/token-stats/balance**", lambda r: full(r, BALANCE))


async def open_settings(page):
    await page.locator("text=设置").first.click(timeout=8000)
    await page.wait_for_timeout(3500)
    await page.locator("text=用量统计").first.click(timeout=8000)
    await page.wait_for_timeout(2500)


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        page.on("console", lambda msg: errors.append(f"CONSOLE-ERROR: {msg.text}") if msg.type == "error" and "Failed to load resource" not in msg.text else None)

        # ── Pass 1：真实旧服务端响应（无 cost 字段）→ 兼容 ──
        await page.goto(BASE, wait_until="load", timeout=30000)
        await page.wait_for_timeout(6000)
        await open_settings(page)
        old_ok = await page.locator(".dts-settings").count() > 0
        results.append(("PASS1 旧服务端响应下分区正常渲染（无 cost 不报错）", old_ok and not errors))
        await page.screenshot(path="docs/verify-cost-pass1.png", full_page=False)

        # ── Pass 2：mock 新响应 → 费用/余额断言 ──
        await mock_routes(page)
        await page.reload(wait_until="load", timeout=30000)
        await page.wait_for_timeout(6000)
        await open_settings(page)

        cost_text = await page.locator(".dts-subline").inner_text()
        results.append(("PASS2 概览「估算费用 ¥15.65」", "估算费用" in cost_text and "¥15.65" in cost_text))
        results.append(("PASS2 概览「1 个模型未计价」", "1 个模型未计价" in cost_text))
        results.append(("PASS2 概览「官方余额 ¥88.50（CNY）」", "官方余额" in cost_text and "¥88.50" in cost_text and "CNY" in cost_text))

        model_head = await page.locator(".dts-tbl-model thead").inner_text()
        results.append(("PASS2 模型表含「费用」列", "费用" in model_head))
        model_body = await page.locator(".dts-tbl-model tbody").inner_text()
        results.append(("PASS2 模型费用值（¥12.05 与 —）", "¥12.05" in model_body and "—" in model_body))

        hist_table = page.locator(".dts-table-scroll table").filter(has_text="日期").first
        hist_head = await hist_table.locator("thead").inner_text()
        results.append(("PASS2 7 天表含「费用」列", "费用" in hist_head))
        hist_body = await hist_table.locator("tbody").inner_text()
        results.append(("PASS2 7 天表费用值（¥15.65 / ¥9.75 / —）", "¥15.65" in hist_body and "¥9.75" in hist_body and "—" in hist_body))

        # 宠物弹窗：回主页 → 点宠物 → 面板 meta 含估算费用
        await page.reload(wait_until="load", timeout=30000)
        await page.wait_for_timeout(6000)
        pet = page.locator('button[aria-label*="查看今日 token 用量"]').first
        if await pet.count() > 0:
            await pet.click(timeout=5000)
            await page.wait_for_timeout(1200)
            pop = await page.locator("body").inner_text()
            results.append(("PASS2 宠物弹窗含「估算费用 ¥15.65」", "估算费用" in pop and "¥15.65" in pop))
            await page.screenshot(path="docs/verify-cost.png", full_page=False)
        else:
            results.append(("PASS2 宠物弹窗含「估算费用 ¥15.65」", False))

        results.append(("PASS2 无页面/控制台错误", not errors))
        if errors:
            print("ERRORS:", errors[:5])
        await browser.close()

    ok = True
    for name, passed in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}")
        ok = ok and passed
    print(f"\n=== 结果：{sum(1 for _, v in results if v)} / {len(results)} 通过 ===")
    raise SystemExit(0 if ok else 1)


asyncio.run(main())
