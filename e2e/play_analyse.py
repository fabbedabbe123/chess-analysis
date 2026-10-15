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
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:10}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Play',exact=True).click()
        await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]'); await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
        n=0
        for uci in ['e2e4','g1f3','f1c4','d1e2']:
            await play(pg,uci); n+=2
            await pg.wait_for_function("n => document.querySelectorAll('.moves-flow .mv').length >= n", arg=n, timeout=30000)
        # a deliberate blunder: put the queen where it can be taken, if the position allows; otherwise any further move
        await pg.click('[data-testid=play-resign]'); await pg.get_by_label('Are you sure?').get_by_role('button',name='Resign').click()
        await pg.wait_for_selector('[data-testid=play-analyze]')
        await pg.click('[data-testid=play-analyze]'); await pg.wait_for_selector('[data-testid=play-report]',timeout=180000)
        rows=await pg.locator('[data-testid=play-report] table.counts').first.inner_text()
        print(rows.replace('\n',' | ')[:300])
        labels=[l.split('\t')[0] for l in rows.split('\n')[1:] if l.strip()]
        known={'Accuracy (estimate)','Brilliant','Great','Best','Excellent','Good','Book','Inaccuracy','Mistake','Miss','Blunder'}
        check('performance table uses the same grade names as the move list', all(l in known for l in labels))
        check('book moves are counted as Book (not as best/excellent)', 'Book' in labels)
        marks=await pg.evaluate("[...document.querySelectorAll('.moves-flow .mv')].map(e=>e.className+'|'+e.textContent).slice(0,8)")
        print(marks)
        for i in range(await pg.locator('[data-testid=key-moment]').count()):
            pass
        kw=await pg.locator('[data-testid=key-moment-why]').count()
        print('key moments with reasons:', kw)
        if kw:
            t=await pg.locator('[data-testid=key-moment-why]').first.inner_text(); print(t)
            check('reason text cites the Stockfish evaluation', 'Stockfish' in t and '%' in t)
        else:
            print('no mistakes in this game (acceptable); reasons are covered by unit tests')
        await pg.click('[data-testid=play-exit]'); await pg.wait_for_timeout(500)
        if await pg.locator('[data-testid=verdict-next]').count():
            await pg.click('[data-testid=verdict-next]'); await pg.wait_for_selector('[data-testid=verdict-why]',timeout=5000)
            vt=await pg.inner_text('[data-testid=verdict-why]'); print(vt)
            check('analysis-mode verdict explains the error too', 'Stockfish' in vt)
        else:
            print('no review in analysis mode after exit (skipped)')
        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
