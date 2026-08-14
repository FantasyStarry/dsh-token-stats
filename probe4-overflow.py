"""诊断移动端表格溢出。"""
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
        await page.set_viewport_size({"width": 720, "height": 900})
        await page.wait_for_timeout(1500)
        info = await page.evaluate("""
        () => {
          const out = {};
          for (const cls of ['.dts-tbl-model', '.dts-tbl-session', '.dts-table-scroll']) {
            const el = document.querySelector(cls);
            if (!el) { out[cls] = 'MISSING'; continue; }
            out[cls] = { clientW: el.clientWidth, scrollW: el.scrollWidth, diff: el.scrollWidth - el.clientWidth };
          }
          const m = document.querySelector('.dts-tbl-model');
          out.modelHeaders = m ? [...m.querySelectorAll('th')].map(th => th.innerText) : null;
          const s = document.querySelector('.dts-tbl-session');
          out.sessionHeaders = s ? [...s.querySelectorAll('th')].map(th => th.innerText) : null;
          // 每个 td 的 rect 是否超出容器右边界
          const cont = document.querySelector('.dts-tbl-model');
          const cr = cont.getBoundingClientRect();
          out.modelTdsOverflow = cont ? [...cont.querySelectorAll('td')].filter(td => td.getBoundingClientRect().right > cr.right + 1).map(td => td.innerText.slice(0, 12)) : null;
          return out;
        }
        """)
        print(json.dumps(info, ensure_ascii=False, indent=1))
        await browser.close()


asyncio.run(main())
