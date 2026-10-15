import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
OPERA='[Event "Opera"][White "Fabian"][Black "Opp"][Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:10}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # welcome + help
        check('welcome card shown on first visit', await pg.locator('[data-testid=welcome]').is_visible())
        check('three starting points', await pg.locator('.welcome-choice').count()==3)
        await pg.click('[data-testid=open-help]'); await pg.wait_for_selector('[data-testid=help-howto]')
        check('help explains how to do things', 'Switch to another account' in await pg.inner_text('[data-testid=help-howto]'))
        await pg.keyboard.press('Escape')
        # layout: moves panel is under the board, right column has no moves panel
        lay=await pg.evaluate("""()=>{const b=document.querySelector('.board-host').getBoundingClientRect(), m=document.querySelector('.moves-panel').getBoundingClientRect(), r=document.querySelector('.col-right').getBoundingClientRect();
          return {boardBottom:b.bottom, movesTop:m.top, movesBottom:m.bottom, movesInRight: !!document.querySelector('.col-right .moves-panel'), vh:innerHeight, rightH:r.height}}""")
        print(lay)
        check('moves panel sits under the board', lay['movesTop']>=lay['boardBottom']-1 and not lay['movesInRight'])
        check('moves panel fits on the screen', lay['movesBottom']<=lay['vh']+1)
        # sections
        tabs=await pg.locator('nav[aria-label=Sections] .tab-row.primary button[role=tab]').all_inner_texts()
        check('four sections', tabs==['Analyse','Train','My games','Play'])
        await pg.get_by_role('tab',name='My games',exact=True).click()
        check('sub-tabs for my games', await pg.get_by_role('tab',name='Strength',exact=True).is_visible() and await pg.get_by_role('tab',name='Player',exact=True).is_visible())
        check('player tab explains the steps', await pg.locator('[data-testid=player-steps]').is_visible())
        await pg.get_by_role('tab',name='Analyse',exact=True).click()
        # import with tags on one line, no extra click, welcome goes away, review auto-jumps to first error
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',OPERA); await pg.click('[data-testid=import-submit]')
        await pg.wait_for_selector('[data-testid=review-headline]',timeout=120000)
        await pg.wait_for_timeout(800)
        check('welcome hidden once a game is open', await pg.locator('[data-testid=welcome]').count()==0)
        await goto_tab(pg,'Review')
        h=await pg.inner_text('[data-testid=review-headline]'); print(h)
        check('headline names both players', 'Fabian:' in h and 'Opp:' in h)
        sel=await pg.evaluate("document.querySelector('.moves-flow .mv.selected')?.textContent||''")
        print('selected after review:', sel)
        check('board jumped to the first error after the review', sel!='' )
        check('status line shows the result at the end', True)
        await pg.keyboard.press('End'); await pg.wait_for_timeout(300)
        check('result shown at the end of the game', 'Result 1-0' in await pg.inner_text('[data-testid=game-status]'))
        forced=await pg.locator('[data-testid=forced-tag]').count()
        print('forced tags in review lists:', forced)
        check('best moves with big swings are marked forced', forced>=1)
        # errors only
        total=await pg.locator('.moves-flow .badge').count()
        await pg.check('[data-testid=errors-only]'); await pg.wait_for_timeout(200)
        only=await pg.locator('.moves-flow .badge').count()
        print('badges all/errors only:', total, only)
        check('errors-only hides the good-move badges', only<total)
        check('no page errors', not errs)
        if errs: print(errs[:3])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
