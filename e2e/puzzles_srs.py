# Spaced repetition + optional Lichess puzzles. NOTE: the Lichess network call is MOCKED here (sandbox cannot reach lichess.org);
# the real API format was checked separately in a real browser and the REAL entry below was copied from it.
import asyncio, os, json, time
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
REAL={'game':{'pgn':'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f3 e5 Nb3 Be6 Bg5 Be7 Bxf6 Bxf6 Nd5 Bxd5 Qxd5 Nc6 Bc4 O-O O-O Rc8 a3 b5 Be2 Kh8 Rfd1 Be7 c3 f5 Nd2 f4 c4 Rf6 cxb5 axb5 Bxb5 Qb6+ Kh1 Nd4 a4 Rg6 Nc4 Qd8 a5 Bh4 Nb6 Rc2 Bf1 Rh6 b4 Bg3 h3'},'puzzle':{'id':'3mKyB','rating':1566,'plays':2906,'solution':['h6h3','g2h3','c2h2','h1g1','d4f3'],'themes':['middlegame','long','mateIn3'],'initialPly':56}}
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        mode={'fail':False}
        async def batch(route):
            if mode['fail']: await route.abort(); return
            await route.fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/json'},body=json.dumps({'puzzles':[REAL]}))
        await pg.route('https://lichess.org/api/puzzle/**',batch)
        await pg.goto(URL); await pg.evaluate("localStorage.clear()")
        past=int(time.time()*1000)-86400000
        await pg.evaluate("t=>localStorage.setItem('chess-analysis:puzzles:v1',JSON.stringify({solved:{p001:{attempts:1,clean:true}},streak:0,bestStreak:0,srs:{p001:{box:2,due:t}}}))",past)
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Puzzles').click()
        await pg.wait_for_function("!document.querySelector('[data-testid=puzzle-review]')?.disabled",timeout=10000)
        check('a due puzzle enables the review button', 'Review 1 due' in await pg.inner_text('[data-testid=puzzle-review]'))
        await pg.click('[data-testid=puzzle-review]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        await pg.get_by_role('button',name='Show solution').click(); await pg.wait_for_timeout(300)
        st=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:puzzles:v1')"))
        check('a miss sends it back to box 1, due in the future', st['srs']['p001']['box']==1 and st['srs']['p001']['due']>time.time()*1000)
        await pg.get_by_role('button',name='Exit puzzles').click()
        check('nothing due afterwards', await pg.locator('[data-testid=puzzle-review][disabled]').count()==1)
        # online puzzles
        await pg.click('[data-testid=puzzle-online]'); await pg.wait_for_function("document.querySelector('[data-testid=puzzle-online-note]')?.innerText.includes('Added')")
        check('one Lichess puzzle added', 'Added 1 new puzzle' in await pg.inner_text('[data-testid=puzzle-online-note]'))
        saved=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:lichess-puzzles:v1')"))
        check('saved with a li- id and the solver to move', saved[0]['id']=='li-3mKyB' and saved[0]['theme']=='mate3')
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Puzzles').click()
        check('survives reload', '1 saved' in await pg.inner_text('.puzzle-panel'))
        mode['fail']=True
        await pg.click('[data-testid=puzzle-online]'); await pg.wait_for_function("document.querySelector('[data-testid=puzzle-online-note]')?.innerText.includes('Could not reach')")
        check('network failure is reported and bundled puzzles stay', await pg.locator('[data-testid=puzzle-start]:not([disabled])').count()==1)
        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
