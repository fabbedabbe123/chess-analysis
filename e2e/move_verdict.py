import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGN='1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
def ok(c,t):
    print(('PASS ' if c else 'FAIL ')+t)
    if not c: ok.bad+=1
ok.bad=0
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({autoReviewOnImport:false}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        ok(await pg.locator('[data-testid=move-verdict]').count()==0, 'no verdict card on an empty board')
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text','1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nxe5 Nxe5 5. d4 Bxd4 6. Qxd4 Nxc4 7. Qxc4 Nf6 8. Nc3 O-O 9. O-O d6 *'); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(300)
        if await pg.get_by_role('button',name='Load selected game').count(): await pg.get_by_role('button',name='Load selected game').click()
        await pg.wait_for_timeout(600)
        ok(await pg.locator('[data-testid=verdict-review]').count()==1, 'verdict card offers "Review game" after import')
        await pg.get_by_role('tab',name='Review').click(); await pg.fill('input[aria-label="Review depth"]','10')
        await pg.click('[data-testid=verdict-review]')
        await pg.wait_for_selector('[data-testid=verdict-next]', timeout=120000)
        await pg.wait_for_timeout(500)
        print('   current:', (await pg.inner_text('[data-testid=move-verdict]')).replace('\n',' | '))
        n=int((await pg.inner_text('.verdict-nav .small-print')).split()[0]); ok(n>=1, f'{n} error(s) found')
        ok('Start position' in await pg.inner_text('[data-testid=move-verdict]'), 'at the start there is no move verdict')
        await pg.click('[data-testid=verdict-next]'); await pg.wait_for_timeout(300)
        t=await pg.inner_text('[data-testid=move-verdict]'); print('   after Next error:', t.replace('\n',' | '))
        cls=(await pg.inner_text('[data-testid=verdict-class]')).strip()
        ok(cls in ('Inaccuracy','Mistake','Blunder','Miss'), f'Next error lands on a bad move ({cls})')
        sel=await pg.locator('.move-list .current, .move-list .mv.active, .move-list [aria-current]').count()
        before=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        if await pg.locator('[data-testid=verdict-try]').count():
            await pg.click('[data-testid=verdict-try]'); await pg.wait_for_timeout(400)
            after=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
            ok(after!=before, 'Try it on the board plays the engine move as a variation')
        await pg.screenshot(path='/tmp/claude-0/verdict.png')
        ok(not logs, f'no page errors {logs[:2]}')
        await b.close()
    print('FAILED' if ok.bad else 'ALL PASSED'); raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
