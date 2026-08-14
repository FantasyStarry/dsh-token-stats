"""切换工作区后 dump 侧边栏文本与元素类名。"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        await page.locator("div.YDXeBa_projectRow").first.click(timeout=5000)
        await page.wait_for_timeout(4000)
        body = await page.evaluate("() => document.body.innerText")
        print("=== 切换后 body 文本（前 2500） ===")
        print(body[:2500])
        # 侧边栏所有元素的类名（含 session 字样的）
        cls = await page.evaluate("""
        () => [...document.querySelectorAll('[class*="session" i], [class*="Session" i]')].slice(0, 30).map(el => ({ cls: (el.className||'').toString().slice(0,70), text: (el.innerText||'').trim().slice(0,50) }))
        """)
        print("=== 含 session 的元素 ===")
        for c in cls:
            print(c)
        await browser.close()

asyncio.run(main())
