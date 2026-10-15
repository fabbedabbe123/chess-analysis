import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        # desktop: collapsible moves panel grows the board and is remembered
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        w0=(await pg.locator('cg-board').bounding_box())['width']
        await pg.click('[data-testid=moves-toggle]'); await pg.wait_for_timeout(250)
        w1=(await pg.locator('cg-board').bounding_box())['width']
        check(f'hiding the moves panel grows the board ({w0:.0f}->{w1:.0f})', w1>w0+30)
        check('move list hidden', await pg.locator('[data-testid=move-list]').count()==0)
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(300)
        check('choice remembered after reload', await pg.locator('[data-testid=move-list]').count()==0)
        await pg.click('[data-testid=moves-toggle]'); await pg.wait_for_timeout(200)
        check('moves can be shown again', await pg.locator('[data-testid=move-list]').count()==1)
        # mobile: six section buttons, sub-tabs inside a section
        m=await (await b.new_context(viewport={'width':390,'height':844})).new_page()
        m.on('console',lambda x: errs.append(x.text) if x.type=='error' else None)
        await m.goto(URL); await m.evaluate("localStorage.clear()"); await m.reload(); await m.wait_for_selector('cg-board')
        bar=await m.locator('.mobile-tabs button').all_inner_texts()
        check(f'mobile bar has six buttons {bar}', bar==['Board','Analyse','Train','My games','Play','Menu'])
        await m.locator('.mobile-tabs button',has_text='Train').click(); await m.wait_for_timeout(300)
        check('train shows Learn/Puzzles sub-tabs', await m.get_by_role('tab',name='Puzzles',exact=True).is_visible() and await m.get_by_role('tab',name='Learn',exact=True).is_visible())
        await m.get_by_role('tab',name='Puzzles',exact=True).click(); await m.wait_for_timeout(300)
        check('puzzle panel visible', await m.locator('.p-puzzles').is_visible())
        await m.locator('.mobile-tabs button',has_text='My games').click(); await m.wait_for_timeout(300)
        check('my games shows its panel', await m.locator('.right-panels > div:visible').count()==1)
        hs=await m.evaluate('document.documentElement.scrollWidth>innerWidth')
        check('no horizontal scroll on mobile', not hs)
        await m.screenshot(path=os.environ.get('SHOT','/tmp/claude-0/mobile_games.png'))
        check('no page errors', not errs)
        if errs: print(errs[:3])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
