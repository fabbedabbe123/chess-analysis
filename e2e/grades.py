import asyncio, os, sys
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGN=sys.argv[1] if len(sys.argv)>1 else '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0'
DEPTH=sys.argv[2] if len(sys.argv)>2 else '12'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',PGN); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(300)
        if await pg.get_by_role('button',name='Load selected game').count(): await pg.get_by_role('button',name='Load selected game').click()
        await pg.get_by_role('tab',name='Review').click(); await pg.fill('input[aria-label="Review depth"]',DEPTH)
        await pg.click('[data-testid=run-review]'); await pg.wait_for_selector('[data-testid=accuracy-w]', timeout=280000)
        n=await pg.locator('.move-list .mv').count()
        for g in ['brilliant','great','best','excellent','good','book','inaccuracy','mistake','miss','blunder']:
            print(f'{g:11s} W {await pg.inner_text(f"[data-testid=grade-w-{g}]")}  B {await pg.inner_text(f"[data-testid=grade-b-{g}]")}')
        await pg.click('.move-list .mv >> nth=0')
        for i in range(n):
            await pg.click(f'.move-list .mv >> nth={i}'); await pg.wait_for_timeout(80)
            t=(await pg.inner_text('[data-testid=move-verdict]')).replace('\n',' | ')
            print(' ', t[:140])
        await pg.screenshot(path='/tmp/claude-0/grades.png')
        print('errors', logs); await b.close()
asyncio.run(main())
