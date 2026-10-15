import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    await pg.mouse.click(*await sq_xy(pg,uci[:2])); await pg.wait_for_timeout(80); await pg.mouse.click(*await sq_xy(pg,uci[2:4])); await pg.wait_for_timeout(200)
async def plies(pg): return await pg.evaluate("document.querySelectorAll('.moves-flow .mv').length")
async def main():
    ok=True
    def check(name,cond):
        nonlocal ok; print(('PASS ' if cond else 'FAIL ')+name); ok = ok and bool(cond)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1280,'height':800}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # 1. sidebar collapse
        w0=(await pg.locator('cg-board').bounding_box())['width']
        await pg.click('[data-testid=side-toggle]'); await pg.wait_for_timeout(200)
        w1=(await pg.locator('cg-board').bounding_box())['width']
        check(f'collapsing the side menu grows the board ({w0:.0f}->{w1:.0f})', w1>w0)
        check('side body hidden', not await pg.locator('.side-body').is_visible())
        await pg.reload(); await pg.wait_for_selector('cg-board')
        check('collapse state persists across reload', await pg.evaluate("document.querySelector('.app').classList.contains('side-collapsed')"))
        await pg.click('[data-testid=side-toggle]'); await pg.wait_for_timeout(200)
        check('expands again', await pg.locator('.side-body').is_visible())
        # 2. play session resume
        await pg.get_by_role('tab',name='Play',exact=True).click()
        check('no resume banner at first', await pg.locator('[data-testid=play-resume-banner]').count()==0)
        await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]'); await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
        await play(pg,'e2e4'); await pg.wait_for_function("document.querySelectorAll('.moves-flow .mv').length>=2",timeout=30000)
        await play(pg,'d2d4'); await pg.wait_for_function("document.querySelectorAll('.moves-flow .mv').length>=4",timeout=30000)
        n=await plies(pg)
        await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Play',exact=True).click()
        check('resume banner after reload', await pg.locator('[data-testid=play-resume-banner]').count()==1)
        check('user own game untouched while a session is only saved', await plies(pg)==0)
        await pg.click('[data-testid=play-resume]'); await pg.wait_for_selector('[data-testid=play-status]')
        await pg.wait_for_timeout(500)
        check(f'resumed game has the same moves ({n})', await plies(pg)>=n)
        await pg.get_by_role('button',name='Leave').first.click() if await pg.get_by_role('button',name='Leave').count() else None
        # 3. import auto review
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.evaluate("""()=>{localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:8}))}"""); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.click('[data-testid=open-import]')
        await pg.fill('textarea.import-text','1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *')
        await pg.click('[data-testid=import-submit]')
        if await pg.get_by_role('button',name='Load selected game').count(): await pg.get_by_role('button',name='Load selected game').click()
        await pg.wait_for_selector('[data-testid=review-summary], [data-testid^=grade-w-]',timeout=90000)
        check('review ran automatically after import', await pg.locator('[data-testid^=grade-w-]').count()>0)
        check('review tab is shown', await pg.get_by_role('tab',name='Review').get_attribute('aria-selected')=='true')
        # 4. lesson deep-link + new lessons
        await pg.get_by_role('tab',name='Learn').click()
        if await pg.locator('[data-testid=learn-back]').count(): await pg.click('[data-testid=learn-back]')
        for sid in ['opposition','lucena','philidor']:
            check(f'lesson {sid} listed', await pg.locator(f'[data-testid=skill-{sid}]').count()==1)
        check('no page errors', not errs)
        if errs: print(errs[:5])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
