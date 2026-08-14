"""验证 dsh-token-stats 插件在 Web GUI 中的展示。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3080"
OUT = "C:/Users/Mayn/Desktop/File_Manager_Legacy/tools/dsh-plugins/token-stats/verify"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: console_errors.append(f"PAGEERROR: {err}"))

    page.goto(URL, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(4000)  # 等客户端插件物化

    body = page.content()
    # 1) 侧边栏小部件
    widget_found = "今日" in body and "tok" in body
    print(f"侧边栏小部件文本可见: {widget_found}")

    # 找包含 '今日' 的元素并截图区域
    page.screenshot(path=f"{OUT}-sidebar.png", full_page=False)

    # 2) 点击小部件展开明细
    clicked = False
    try:
        page.get_by_text("tok", exact=False).first.click(timeout=5000)
        clicked = True
        page.wait_for_timeout(800)
    except Exception as e:
        print(f"点击小部件失败: {e}")
    page.screenshot(path=f"{OUT}-widget-open.png")

    # 3) 设置页 → 用量统计
    try:
        # 侧边栏底部设置入口
        page.locator("text=设置").first.click(timeout=5000)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}-settings.png")
        body2 = page.content()
        section_found = "用量统计" in body2
        print(f"设置页出现'用量统计'分区: {section_found}")
        if section_found:
            try:
                page.get_by_text("用量统计", exact=True).first.click(timeout=5000)
                page.wait_for_timeout(1500)
                page.screenshot(path=f"{OUT}-settings-section.png")
                body3 = page.content()
                print(f"分区内容渲染(今日 token 用量): {'今日 token 用量' in body3}")
                print(f"分区内容渲染(最近 7 天): {'最近 7 天' in body3}")
            except Exception as e:
                print(f"点击用量统计分区失败: {e}")
    except Exception as e:
        print(f"打开设置页失败: {e}")

    # 4) 命令 /usage 测试（对话输入框输入 /usage）
    try:
        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)
        # 找对话输入框（textarea 或 contenteditable）
        input_el = page.locator("textarea").first
        if input_el.count() == 0:
            input_el = page.locator("[contenteditable=true]").first
        if input_el.count() > 0:
            input_el.click()
            page.keyboard.type("/usage")
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{OUT}-command-menu.png")
            page.keyboard.press("Enter")
            page.wait_for_timeout(3000)
            page.screenshot(path=f"{OUT}-command-result.png")
            body4 = page.content()
            print(f"命令输出包含'今日': {'今日' in body4 and 'token' in body4}")
        else:
            print("未找到对话输入框")
    except Exception as e:
        print(f"命令测试失败: {e}")

    print(f"\nconsole 错误数: {len(console_errors)}")
    for err in console_errors[:10]:
        print(f"  - {err[:200]}")
    browser.close()
