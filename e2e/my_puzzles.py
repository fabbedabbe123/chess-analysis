import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def check(name, cond): print(('PASS ' if cond else 'FAIL ')+name)
async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    await pg.mouse.click(*await sq_xy(pg,uci[:2])); await pg.wait_for_timeout(80); await pg.mouse.click(*await sq_xy(pg,uci[2:4])); await pg.wait_for_timeout(300)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900}, permissions=['clipboard-read','clipboard-write'])
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        for m in ['f2f3','e7e5','g2g4']: await play(pg,m)   # position: black to move, Qh4# wins
        await goto_tab(pg,'Puzzles')
        check('empty "My puzzles" before making one', await pg.locator('[data-testid=mine-empty]').count()==1)
        await pg.click('[data-testid=mine-new]'); await pg.click('[data-testid=builder-start]')
        await pg.wait_for_selector('[data-testid=builder-active]')
        check('save is disabled until a solution exists', await pg.locator('[data-testid=builder-save]').is_disabled())
        await play(pg,'d8h4')
        txt=await pg.inner_text('[data-testid=builder-moves]')
        check(f'the recorded move is shown ({txt.strip()})', 'Qh4' in txt)
        check('save is enabled after the solver move', await pg.locator('[data-testid=builder-save]').is_enabled())
        await pg.fill('[data-testid=builder-title]', "Fool's mate"); await pg.fill('[data-testid=builder-why]', 'The white king has no escape.')
        await pg.click('[data-testid=builder-verify]')
        await pg.wait_for_function("document.querySelector('[data-testid=builder-check]') && !document.querySelector('[data-testid=builder-check]').innerText.includes('checking')", timeout=60000)
        ctext=await pg.inner_text('[data-testid=builder-check]'); print('engine check:', ctext)
        check('Stockfish confirms the mating first move', 'also picks' in ctext)
        await pg.click('[data-testid=builder-save]')
        await pg.wait_for_selector('[data-testid=mine-item]')
        check('puzzle appears under My puzzles', await pg.locator('[data-testid=mine-item]').count()==1 and "Fool's mate" in await pg.inner_text('[data-testid=mine-item]'))
        # persistence
        await pg.reload(); await pg.wait_for_selector('cg-board'); await goto_tab(pg,'Puzzles')
        check('survives a reload', await pg.locator('[data-testid=mine-item]').count()==1)
        # share link -> clipboard
        await pg.click('[data-testid=mine-share]'); await pg.wait_for_timeout(300)
        link=await pg.evaluate("navigator.clipboard.readText()")
        check('share copies a link with a puzzle code', '#p=cp1.' in link)
        # solve it
        await pg.locator('[data-testid=mine-item] .moment').click(); await pg.wait_for_selector('[data-testid=puzzle-active]')
        check('puzzle opens with the author position (black to move)', 'Black to move' in await pg.inner_text('[data-testid=puzzle-active]'))
        await play(pg,'d8h4'); await pg.wait_for_selector('[data-testid=lesson-why]',timeout=20000)
        check('solving it shows the author explanation', 'no escape' in await pg.inner_text('[data-testid=lesson-why]'))
        await pg.get_by_role('button',name='Exit puzzles').click(); await goto_tab(pg,'Puzzles')
        check('the puzzle is marked solved in the list', 'solved' in (await pg.inner_text('[data-testid=mine-item]')).lower())
        # a friend opens the link in a fresh browser profile
        ctx2=await b.new_context(viewport={'width':1440,'height':900}); pg2=await ctx2.new_page(); errs2=[]; pg2.on('pageerror',lambda e: errs2.append(str(e)))
        await pg2.goto(link); await pg2.wait_for_selector('cg-board'); await pg2.wait_for_timeout(600)
        check('opening the link offers/adds the puzzle', 'added' in (await pg2.inner_text('body')).lower())
        check('the address bar is cleaned', '#p=' not in pg2.url)
        await goto_tab(pg2,'Puzzles')
        check('friend sees the puzzle', await pg2.locator('[data-testid=mine-item]').count()==1)
        # importing the same code again does not duplicate
        code=link.split('#p=')[1]
        await pg2.fill('[data-testid=mine-import-text]', code); await pg2.click('[data-testid=mine-import]'); await pg2.wait_for_timeout(200)
        check('same puzzle twice is not duplicated', await pg2.locator('[data-testid=mine-item]').count()==1 and 'already' in await pg2.inner_text('[data-testid=mine-note]'))
        await pg2.fill('[data-testid=mine-import-text]', 'garbage'); await pg2.click('[data-testid=mine-import]')
        check('a bad code gives a clear message', 'does not look like' in await pg2.inner_text('[data-testid=mine-note]'))
        # delete
        await pg.click('[data-testid=mine-delete]'); await pg.get_by_role('button',name='Delete').last.click(); await pg.wait_for_timeout(200)
        check('delete removes it', await pg.locator('[data-testid=mine-item]').count()==0)
        check('no page errors', errs==[] and errs2==[])
        await b.close()
asyncio.run(main())
