import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    await pg.mouse.click(*await sq_xy(pg,uci[:2])); await pg.wait_for_timeout(60); await pg.mouse.click(*await sq_xy(pg,uci[2:4])); await pg.wait_for_timeout(300)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text','1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(500)
        await goto_tab(pg,'Review'); await pg.click('[data-testid=run-review]'); await pg.wait_for_selector('[data-testid=accuracy-w]',timeout=120000)
        await goto_tab(pg,'Puzzles')
        items=await pg.locator('.puzzle-panel .moment').all_inner_texts(); print('mistake puzzles offered:', [i.replace('\n',' | ') for i in items])
        await pg.locator('.puzzle-panel .moment').first.click(); await pg.wait_for_selector('[data-testid=puzzle-active]',timeout=10000)
        print('start msg:', await pg.inner_text('[data-testid=puzzle-message]'))
        await play(pg,'g8h6')   # a reasonable alternative: Nh6 covers f7
        await pg.wait_for_timeout(4000)
        print('alternative Nh6 judged by real Stockfish ->', (await pg.inner_text('[data-testid=puzzle-message]')).strip())
        await pg.screenshot(path='/tmp/claude-0/puzzle_mistake.png')
        print('LOGS',logs); await b.close()
asyncio.run(main())
