"""DOM 断言验证：KPI 卡片并排、柱状图数量、占比条宽度、平均输出小数修复。"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        await page.locator("text=设置").first.click(timeout=5000)
        await page.wait_for_timeout(3500)
        await page.locator("text=用量统计").first.click(timeout=5000)
        await page.wait_for_timeout(2500)

        # KPI 卡片：找到 4 个大数字卡（flex 容器内的 4 个 div）
        info = await page.evaluate("""
        () => {
          const out = {};
          // 平均输出文本
          const metrics = [...document.querySelectorAll('p')].map(p => p.innerText).find(t => t.includes('平均输入'));
          out.metrics = metrics || null;
          // 占比条：track 与 fill
          const bars = [...document.querySelectorAll('div')].filter(d => {
            const s = getComputedStyle(d);
            return s.borderRadius === '3px' && s.height === '6px' && d.children.length === 1 && d.parentElement && d.parentElement.children.length <= 2;
          });
          out.shareTracks = bars.length;
          // 柱状图柱子（9px 宽的 div）
          const cols = [...document.querySelectorAll('div')].filter(d => getComputedStyle(d).width === '9px');
          out.barColumns = cols.length;
          // KPI 卡片位置：字号 20px 的数值
          const vals = [...document.querySelectorAll('div')].filter(d => {
            const s = getComputedStyle(d);
            return s.fontSize === '20px' && s.fontWeight === '600';
          }).map(d => ({ text: d.innerText, x: Math.round(d.getBoundingClientRect().x), y: Math.round(d.getBoundingClientRect().y) }));
          out.kpiValues = vals;
          // 对账面板：含"对账："文本的块
          const rec = [...document.querySelectorAll('div')].find(d => d.innerText && d.innerText.startsWith('对账：'));
          out.reconcile = rec ? rec.innerText : null;
          // 按会话分组表头
          out.sessionHeads = [...document.querySelectorAll('div')].filter(d => {
            const t = d.innerText || '';
            return t.startsWith('顶层会话（') || t.startsWith('子代理会话（');
          }).map(d => d.innerText);
          return out;
        }
        """)
        print("指标行:", info["metrics"])
        print("KPI 数值:", info["kpiValues"])
        ys = {v["y"] for v in info["kpiValues"]}
        xs = sorted(v["x"] for v in info["kpiValues"])
        print(f"KPI 同一行(y 唯一值数={len(ys)}):", "PASS" if len(ys) == 1 and len(xs) == 4 else "FAIL", xs)
        print("占比条数量:", info["shareTracks"], "PASS" if info["shareTracks"] >= 1 else "FAIL")
        print("柱状图柱子数:", info["barColumns"], "PASS" if info["barColumns"] == 14 else "FAIL")
        print("对账面板:", info["reconcile"], "PASS" if info["reconcile"] and "子代理" in info["reconcile"] else "FAIL")
        print("会话分组:", info["sessionHeads"], "PASS" if any("顶层会话" in h for h in info["sessionHeads"]) and any("子代理会话" in h for h in info["sessionHeads"]) else "FAIL")
        print("页面错误:", errors if errors else "无")
        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-settings.png")
        await browser.close()

asyncio.run(main())
