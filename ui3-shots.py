"""ui3 截图：提供商 chips / 30 天展开 / 移动端表格（v0.9 合并后）。"""
import asyncio
import json
import time

from playwright.async_api import async_playwright

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
        "models": {"gpt-5.6-sol": {"requests": 2, "inputTokens": 44756, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 3000, "reasoningTokens": 0}},
    },
}
HISTORY = [
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
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})

        async def mock_summary(route):
            await route.fulfill(status=200, content_type="application/json", body=json.dumps({
                "day": time.strftime("%Y-%m-%d"), "total": PROVIDERS["opencode-go"]["total"], "providers": PROVIDERS,
                "activity": {"lastAt": 0, "completions": []},
            }))

        async def mock_history(route):
            await route.fulfill(status=200, content_type="application/json", body=json.dumps({"days": HISTORY}))

        async def mock_sessions(route):
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(SESSIONS))

        await page.route("**/token-stats/summary**", mock_summary)
        await page.route("**/token-stats/history**", mock_history)
        await page.route("**/token-stats/sessions**", mock_sessions)
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)
        await page.get_by_text("设置", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(2500)
        await page.get_by_text("用量统计", exact=True).first.click(timeout=5000)
        await page.wait_for_timeout(2500)
        # 滚动到 30 天小节并展开
        await page.mouse.move(800, 500)
        await page.mouse.wheel(0, 1200)
        await page.wait_for_timeout(600)
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui3-settings-desktop.png")
        toggle = page.get_by_text("最近 30 天", exact=False).first
        if await toggle.count() > 0:
            await toggle.click()
            await page.wait_for_timeout(1200)
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui3-settings-30days.png")
        await page.mouse.wheel(0, -1200)
        await page.wait_for_timeout(400)
        await page.set_viewport_size({"width": 720, "height": 900})
        await page.wait_for_timeout(1200)
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui3-settings-mobile.png")
        await browser.close()


asyncio.run(main())
