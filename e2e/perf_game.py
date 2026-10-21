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
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # one saved game: shown with an Elo for that game only, but no overall rating range yet
        sg=[{'id':'a','source':'import','endedAt':1700000000,'userColor':'w','label':'Test game','moves':40,'acpl':60,'accuracy':80,'counts':{},'catCount':{},'catLoss':{},'myRating':None,'depth':10,'mistakes':[]},
            {'id':'b','source':'import','endedAt':1700001000,'userColor':'w','label':'Short game','moves':12,'acpl':60,'accuracy':80,'counts':{},'catCount':{},'catLoss':{},'myRating':None,'depth':10,'mistakes':[]}]
        await pg.evaluate("v=>localStorage.setItem('chess-analysis:strength-games:v1', v)", json.dumps(sg)); await pg.reload(); await pg.wait_for_selector('cg-board')
        await goto_tab(pg,'Strength'); await pg.wait_for_selector('[data-testid=strength-games]',state='attached')
        await pg.locator('details.card-details summary').first.click() if not await pg.locator('[data-testid=strength-games]').is_visible() else None
        txt=await pg.inner_text('[data-testid=strength-games]')
        ok('≈ ' in txt, f'a long enough game shows its own level in the list ({txt.splitlines()[:6]})')
        ok('12' not in txt.replace('12 cp','') or 'cp' in txt, 'a game with too few moves falls back to cp')
        ok(await pg.locator('[data-testid=strength-range]').count()==0, 'no overall rating range before 10 games')
        # review of an imported game shows a per-colour line
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',PGNS[0]); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(300)
        if await pg.get_by_role('button',name='Load selected game').count(): await pg.get_by_role('button',name='Load selected game').click()
        await goto_tab(pg,'Review'); await pg.fill('input[aria-label="Review depth"]','6')
        await pg.click('[data-testid=run-review]'); await pg.wait_for_selector('[data-testid=accuracy-w]', timeout=200000)
        ok(await pg.get_by_test_id('perf-box').count()==1, 'the level has its own box in the review')
        for c in 'wb':
            t=await pg.inner_text(f'[data-testid=perf-{c}]'); ok(('≈' in t) or 'Too few moves' in t, f'the level box shows a number or a reason for {c}: {t}')
        # grade of each move: badge on the board, and clickable grade rows that list those moves
        await pg.wait_for_timeout(300)
        ok(await pg.get_by_test_id('grade-mark').count()==1, 'the current reviewed move has its grade badge on the board')
        await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(200)
        ok(await pg.get_by_test_id('grade-mark').count()==1, 'stepping back shows the previous move\'s grade badge')
        await pg.keyboard.press('Home'); await pg.wait_for_timeout(200)
        ok(await pg.get_by_test_id('grade-mark').count()==0, 'no badge at the start position')
        rows=pg.locator('[data-testid^=grade-row-]:not([disabled])')
        ok(await rows.count()>0, 'grade rows with moves are clickable')
        await rows.first.click(); await pg.wait_for_selector('[data-testid=grade-moves]')
        n=await pg.get_by_test_id('grade-move').count()
        ok(n>0, f'clicking a grade lists its moves ({n})')
        await pg.get_by_test_id('grade-move').first.click(); await pg.wait_for_timeout(300)
        ok(await pg.get_by_test_id('grade-mark').count()==1, 'clicking a listed move jumps to it and shows its badge')
        await pg.click('[data-testid=grade-clear]')
        ok(await pg.get_by_test_id('grade-moves').count()==0, 'the list closes')
        ok(not errs, f'no page errors {errs[:2]}')
        await b.close()
    print('FAILED' if ok.bad else 'ALL PASSED'); raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
