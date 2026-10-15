import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
OPERA='[Event "Opera"]\n[White "Fabian"]\n[Black "Opp"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        for w,h in [(1440,900),(1280,720)]:
            pg=await (await b.new_context(viewport={'width':w,'height':h})).new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:8}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',OPERA); await pg.click('[data-testid=import-submit]')
            await goto_tab(pg,'Review'); await pg.wait_for_selector('[data-testid=count-white]:not([disabled])',timeout=120000); await pg.wait_for_timeout(600)
            m=await pg.evaluate("""()=>{const c=document.querySelector('.col-center'); const bd=document.querySelector('.board-wrap').getBoundingClientRect(); const mv=document.querySelector('.moves-panel').getBoundingClientRect(); return {over:c.scrollHeight-c.clientHeight, top:bd.top, bottom:mv.bottom, vh:innerHeight}}""")
            print(w,h,m)
            check(f'{w}x{h}: centre column does not overflow (board top and moves panel fully visible)', m['over']<=0 and m['top']>=0 and m['bottom']<=m['vh'])
            check(f'{w}x{h}: move verdict shown in Analyse', await pg.locator('[data-testid=move-verdict]').is_visible())
            hw=await pg.evaluate("document.querySelector('[data-testid=open-help]').getBoundingClientRect().width")
            check(f'{w}x{h}: help button is a small round icon, not a tab', hw<=32)
            lab=await pg.evaluate("[...document.querySelectorAll('.tab-row.primary button[role=tab]')].map(b=>b.scrollWidth<=b.clientWidth+1)")
            check(f'{w}x{h}: section tab labels are not truncated', all(lab))
            # foldable review sections
            opened=await pg.evaluate("[...document.querySelectorAll('.review-panel details.fold')].map(d=>d.open)")
            check(f'{w}x{h}: critical moments open, swings/study closed', opened==[True,False,False])
            await goto_tab(pg,'Play')
            check(f'{w}x{h}: stale verdict is hidden on the Play tab', not await pg.locator('[data-testid=move-verdict]').is_visible())
            box=await pg.locator('[data-testid=play-start]').bounding_box()
            check(f'{w}x{h}: Start game is visible without scrolling', box is not None and box['y']+box['height']<=h)
            await goto_tab(pg,'Strength')
            check(f'{w}x{h}: no stale verdict on Strength either', not await pg.locator('[data-testid=move-verdict]').is_visible())
            check(f'{w}x{h}: no page errors', not errs)
            if w==1440:
                n=await pg.get_by_text('My games (Chess.com').count()
                check('sidebar no longer duplicates the My games button', n==0)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
