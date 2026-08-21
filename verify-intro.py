"""介绍页 UI 验证：桌面/移动截图 + 控制台错误 + 复制按钮 + hero 视口检查"""
import asyncio
from playwright.async_api import async_playwright

URL = "file:///C:/Users/Mayn/Desktop/dsh-token-stats/docs/index.html"


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        errors = []
        for name, vw, vh in [("desktop", 1440, 900), ("mobile", 390, 844)]:
            page = await browser.new_page(viewport={"width": vw, "height": vh})
            page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
            page.on("console", lambda msg: errors.append(f"CONSOLE: {msg.text}") if msg.type == "error" else None)
            await page.goto(URL, wait_until="load", timeout=30000)
            await page.wait_for_timeout(1500)

            if name == "desktop":
                # hero 首屏：h1 是否 2 行内、CTA 可见
                h1 = await page.locator("h1").bounding_box()
                btn = await page.locator("#hero-copy").bounding_box()
                results.append(("desktop hero h1 顶部 < 720px 且 CTA 在首屏内", h1 and btn and h1["y"] < 400 and btn["y"] + btn["height"] < 900))
                # 复制按钮交互
                await page.locator("#hero-copy").click()
                await page.wait_for_timeout(300)
                label = await page.locator("#hero-copy span").inner_text()
                results.append(("desktop 复制按钮反馈（已复制）", label == "已复制"))
                await page.screenshot(path="docs/intro-desktop.png", full_page=True)
            else:
                # 移动端无横向溢出
                overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
                results.append(("mobile 无横向溢出", not overflow))
                await page.screenshot(path="docs/intro-mobile.png", full_page=True)
            await page.close()

        results.append(("无页面/控制台错误", not errors))
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
