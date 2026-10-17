import asyncio, os, re
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
FEN='4k3/8/8/8/8/8/4P3/4K2R w - - 0 1'
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
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await play(pg,'e2e4'); await play(pg,'e7e5')
        mine=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        await goto_tab(pg,'Play')
        # invalid and finished positions are refused
        await pg.click('[data-testid=from-fen]'); await pg.fill('[data-testid=from-fen-input]','garbage'); await pg.click('[data-testid=play-start]')
        check('garbage FEN refused', await pg.locator('[data-testid=from-error]').count()==1)
        await pg.fill('[data-testid=from-fen-input]','7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'); await pg.click('[data-testid=play-start]')
        check('checkmate position refused with a clear message', 'checkmate' in (await pg.inner_text('[data-testid=from-error]')).lower())
        check('still in setup', await pg.locator('[data-testid=play-status]').count()==0)
        # board position
        await pg.click('[data-testid=from-board]'); await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]')
        await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
        fen=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        check('play from the board position starts there', fen.split()[0]==mine.split()[0])
        await pg.click('[data-testid=play-exit]')
        if await pg.get_by_role('button',name='Leave').count(): await pg.get_by_role('button',name='Leave').click()
        await pg.wait_for_timeout(300)
        check('your own game is restored after leaving', (await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")).split()[0]==mine.split()[0])
        # custom FEN + clock
        await goto_tab(pg,'Play')
        await pg.click('[data-testid=from-fen]'); await pg.fill('[data-testid=from-fen-input]',FEN)
        await pg.click('[data-testid="tc-3+2"]'); await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]')
        await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
        fen=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        check('custom FEN is on the board', fen.split()[0]==FEN.split()[0])
        check('clocks show 3:00 before anyone moved', (await pg.inner_text('[data-testid=clock-w]'))=='3:00' and (await pg.inner_text('[data-testid=clock-b]'))=='3:00')
        await play(pg,'h1h2')
        await pg.wait_for_function("document.querySelectorAll('.moves-flow .mv').length >= 2",timeout=30000)
        await pg.wait_for_timeout(300)
        a=await pg.inner_text('[data-testid=clock-w]'); await pg.wait_for_timeout(3200); c=await pg.inner_text('[data-testid=clock-w]')
        def secs(t): m,s=t.split(':'); return int(m)*60+int(s)
        print('clock', a, '->', c)
        check('the clock of the side to move is running after both moved', secs(a)-secs(c)>=2)
        check('the other clock is not running', (await pg.inner_text('[data-testid=clock-b]')) in ('3:00','3:02','2:59','2:58','3:01') )
        # session resume keeps the clock
        fen_after=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        await pg.reload(); await pg.wait_for_selector('cg-board'); await goto_tab(pg,'Play')
        check('unfinished game offered for resume', await pg.locator('[data-testid=play-resume]').count()==1)
        await pg.click('[data-testid=play-resume]'); await pg.wait_for_selector('[data-testid=clock-w]')
        r=secs(await pg.inner_text('[data-testid=clock-w]'))
        check('resumed clock restores the time saved at the last move (not reset to 3:00 base after charges; time away is not charged)', secs(c)<=r<=181)
        fen2=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        check('resumed game replays from the custom start position (moves intact)', await plies(pg)>=2 and fen2.split()[0]==fen_after.split()[0])
        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
