import asyncio, json, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGNS=json.load(open(os.path.join(os.path.dirname(__file__),'strength_pgns.json')))
def ok(c,t):
    print(('PASS ' if c else 'FAIL ')+t)
    if not c: ok.bad+=1
ok.bad=0
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        for (w,h) in ((390,800),(820,700),(1440,900)):
            pg=await (await b.new_context(viewport={'width':w,'height':h})).new_page()
            await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
            if not await pg.locator('[data-testid=open-import]').is_visible(): await pg.get_by_role('button',name='Menu',exact=True).click()
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',PGNS[0]); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(300)
            if await pg.get_by_role('button',name='Load selected game').count(): await pg.get_by_role('button',name='Load selected game').click()
            if await pg.get_by_role('button',name='Board',exact=True).count(): await pg.get_by_role('button',name='Board',exact=True).click()
            await pg.evaluate("window.scrollTo(0,0)")
            y0=await pg.evaluate("document.scrollingElement.scrollTop")
            for i in range(40):
                await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(15)
            y1=await pg.evaluate("document.scrollingElement.scrollTop")
            top=await pg.evaluate("document.querySelector('cg-board').getBoundingClientRect().top")
            ok(y1==y0, f'{w}x{h}: stepping through moves does not scroll the page ({y0} -> {y1})')
            ok(top>=0, f'{w}x{h}: the top of the board stays in view (top={top:.0f})')
            await pg.close()
        await b.close()
    raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
