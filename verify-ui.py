"""DOM 断言验证（v0.3.1 克制数据面板）：
- 拦截 /token-stats/sessions 返回 mock 数据（不依赖服务端是否重启）
- 断言：无页面错误、主数字 + 次级数字、对账行、会话分组表、柱状图 14 根、占比条
"""
import asyncio
import json
from playwright.async_api import async_playwright

MOCK_SESSIONS = {
    "day": "2026-08-14",
    "sessions": [
        {
            "id": "session-85f8702d-af8a-4bbf-9187-e80839e0eeb7",
            "parent": None,
            "subagent": False,
            "requests": 196,
            "inputTokens": 172376,
            "outputTokens": 176449,
            "cacheReadTokens": 26205440,
            "cacheWriteTokens": 0,
            "reasoningTokens": 0,
            "lastAt": 1786678643614,
        },
        {
            "id": "0d9d461f-064c-49e0-a0be-f87df4ffcf39",
            "parent": "session-f5b46c67-19ed-46a5-b19c-a81e42e47670",
            "subagent": True,
            "requests": 57,
            "inputTokens": 137942,
            "outputTokens": 23901,
            "cacheReadTokens": 5273088,
            "cacheWriteTokens": 0,
            "reasoningTokens": 0,
            "lastAt": 1786669789184,
        },
    ],
}


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge")
        page = await browser.new_page(viewport={"width": 1560, "height": 1000})
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PAGEERROR: {err}"))

        async def mock_sessions(route):
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_SESSIONS))

        await page.route("**/token-stats/sessions**", mock_sessions)
        await page.goto("http://127.0.0.1:3080", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        await page.locator("text=设置").first.click(timeout=5000)
        await page.wait_for_timeout(3500)
        await page.locator("text=用量统计").first.click(timeout=5000)
        await page.wait_for_timeout(2500)

        info = await page.evaluate("""
        () => {
          const out = {};
          const all = [...document.querySelectorAll('div')];
          // 主数字：26px 700
          const hero = all.filter(d => {
            const s = getComputedStyle(d);
            return s.fontSize === '26px' && s.fontWeight === '700';
          }).map(d => d.innerText);
          out.hero = hero;
          // 次级数字：16px 500 + 等宽数字（排除宿主的 16px 设置按钮）
          const sub = all.filter(d => {
            const s = getComputedStyle(d);
            return s.fontSize === '16px' && s.fontWeight === '500' && s.fontVariantNumeric === 'tabular-nums';
          }).map(d => d.innerText);
          out.secondary = sub;
          // 指标行
          const metrics = all.map(d => d.innerText || '').find(t => t.includes('平均输入'));
          out.metrics = metrics || null;
          // 对账行
          const rec = all.find(d => (d.innerText || '').startsWith('对账：'));
          out.reconcile = rec ? rec.innerText : null;
          // 会话分组标题
          out.sessionHeads = all.map(d => (d.innerText || '').trim())
            .filter(t => t.startsWith('顶层会话（') || t.startsWith('子代理会话（'));
          // 柱状图柱子（8px 宽 + 上方圆角，计算值格式 2px 2px 0px 0px）
          out.barColumns = all.filter(d => {
            const s = getComputedStyle(d);
            return s.width === '8px' && s.borderRadius === '2px 2px 0px 0px';
          }).length;
          // 占比条（4px 高、2px 圆角）
          out.shareTracks = all.filter(d => {
            const s = getComputedStyle(d);
            return s.height === '4px' && s.borderRadius === '2px' && d.children.length === 1;
          }).length;
          // 分区标题
          out.titles = all.map(d => (d.innerText || '').trim())
            .filter(t => ['模型明细', '会话明细', '最近 7 天'].includes(t));
          return out;
        }
        """)
        ok = True
        def report(name, cond, extra=""):
            nonlocal ok
            ok = ok and cond
            print(f"{'PASS' if cond else 'FAIL'}  {name}{'  (' + extra + ')' if extra else ''}")

        report("主数字（计费输入 26px）", len(info["hero"]) == 1 and info["hero"][0].endswith("M"), str(info["hero"]))
        report("次级数字（请求/输出/缓存读 16px）", len(info["secondary"]) == 3, str(info["secondary"]))
        report("指标行（命中率/均值）", bool(info["metrics"]) and "平均输入" in info["metrics"], str(info["metrics"]))
        report("对账行（顶层＋子代理＝总计）",
               bool(info["reconcile"]) and "顶层会话" in info["reconcile"] and "子代理会话" in info["reconcile"],
               str(info["reconcile"]))
        report("会话分组标题（顶层/子代理）",
               any("顶层会话" in h for h in info["sessionHeads"]) and any("子代理会话" in h for h in info["sessionHeads"]),
               str(info["sessionHeads"]))
        report("柱状图柱子 = 14", info["barColumns"] == 14, str(info["barColumns"]))
        report("占比条存在", info["shareTracks"] >= 1, str(info["shareTracks"]))
        report("分区标题齐全", set(info["titles"]) == {"模型明细", "会话明细", "最近 7 天"}, str(info["titles"]))
        report("无页面错误", len(errors) == 0, "; ".join(errors))

        await page.screenshot(path="C:/Users/Mayn/Desktop/dsh-token-stats/ui-settings.png", full_page=True)
        print(f"\n=== {'全部通过' if ok else '存在失败'} === 截图: ui-settings.png")
        await browser.close()


asyncio.run(main())
