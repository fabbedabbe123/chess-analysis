import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await goto_tab(pg,'Play')
        await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]'); await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
        await pg.click('[data-testid=play-resign]'); await pg.get_by_label('Are you sure?').get_by_role('button',name='Resign').click()
        await pg.wait_for_selector('[data-testid=play-settings]')
        check('settings hidden until asked', await pg.locator('[data-testid=finished-setup]').count()==0)
        await pg.click('[data-testid=play-settings]')
        await pg.wait_for_selector('[data-testid=finished-setup] [data-testid=level-intermediate]')
        await pg.click('[data-testid=level-intermediate]'); await pg.click('[data-testid=color-b]')
        await pg.select_option('[data-testid=opt-tc]', index=1)
        await pg.click('[data-testid=finished-setup] [data-testid=play-start]')
        await pg.wait_for_selector('[data-testid=play-status]')
        pills=await pg.locator('.play-panel .pill').all_inner_texts(); print(pills)
        check('new game uses the new colour', any('Black' in t for t in pills))
        check('new game uses the new level', not any('Beginner' in t for t in pills) and len(pills)>=2)
        check('clock shown for chosen time control', await pg.locator('[data-testid=clock-w]').count()>0)
        check('no page errors', not errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
