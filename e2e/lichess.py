# Lichess tracking + link import. NOTE: network is MOCKED here (sandbox cannot reach lichess.org); the real API was checked separately from a real browser.
import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGN='[Event "Rated blitz game"]\n[Site "https://lichess.org/AbCdEfGh"]\n[White "Me"]\n[Black "Them"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 Bf6 10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 h6 14. Qh5 1-0\n'
def game(i, color='white'):
    w={'user':{'name':'Me'},'rating':1500}; b={'user':{'name':'Them'},'rating':1550}
    return {'id':'G%07d'%i,'variant':'standard','speed':'blitz','status':'resign','createdAt':1700000000000-i*100000,'lastMoveAt':1700000050000-i*100000,'players':{'white':w,'black':b},'winner':'white','opening':{'eco':'C54','name':'Italian Game: Giuoco Piano'},'pgn':PGN}
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1280,'height':800}); pg=await ctx.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        async def games(route):
            reqs.append(route.request.url)
            until='until=' in route.request.url
            body='\n'.join(json.dumps(game(i+(500 if until else 0))) for i in range(3 if until else 100))
            await route.fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/x-ndjson'},body=body)
        async def export(route):
            reqs.append(route.request.url)
            await route.fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/x-chess-pgn'},body=PGN)
        await pg.route('https://lichess.org/api/games/user/**',games)
        await pg.route('https://lichess.org/game/export/**',export)
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.evaluate("localStorage.setItem('chess-analysis:settings:v1',JSON.stringify({autoReviewOnImport:false}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Player').click() if await pg.get_by_role('tab',name='Player').count() else await pg.get_by_role('button',name='Player',exact=True).click()
        await pg.click('[data-testid=source-lichess]')
        await pg.fill('[data-testid=player-input]','Me'); await pg.click('[data-testid=player-track]')
        await pg.wait_for_selector('[data-testid=player-stats]')
        check('100 Lichess games loaded (full page)', '100 games loaded' in await pg.inner_text('[data-testid=player-stats]'))
        check('request used ndjson API with pgnInJson', any('pgnInJson=true' in r for r in reqs))
        check('opening table shows the opening', 'Italian Game' in await pg.inner_text('[data-testid=player-openings]'))
        await pg.click('[data-testid=lichess-older]'); await pg.wait_for_function("document.querySelector('[data-testid=player-stats]').innerText.includes('103 games loaded')")
        check('older page requested with until=', any('until=' in r for r in reqs))
        check('older page exhausts the list (no more button)', await pg.locator('[data-testid=lichess-older]').count()==0)
        stored=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:lichess:v1')"))
        check('saved with cursor and lichess source', stored['cursor'] is not None and stored['games'][0]['source']=='lichess')
        await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Player').click() if await pg.get_by_role('tab',name='Player').count() else await pg.get_by_role('button',name='Player',exact=True).click()
        check('Lichess tab chosen after reload when only Lichess is tracked', await pg.locator('[data-testid=source-lichess].active').count()==1)
        # link import
        await pg.get_by_role('button',name='Import').first.click()
        await pg.fill('textarea[aria-label="PGN or FEN"]','https://lichess.org/AbCdEfGh'); await pg.click('[data-testid=import-submit]')
        await pg.wait_for_function("document.querySelector('.board-wrap')?.dataset.fen && !document.querySelector('.modal')",timeout=15000)
        check('export endpoint fetched with game id', any('/game/export/AbCdEfGh' in r for r in reqs))
        await pg.keyboard.press('Home'); await pg.wait_for_timeout(200)
        names=await pg.inner_text('body')
        check('game from link is loaded (White Me / Black Them)', 'Them' in names)
        await pg.get_by_role('button',name='Import').first.click()
        await pg.fill('textarea[aria-label="PGN or FEN"]','https://www.chess.com/game/live/123'); await pg.click('[data-testid=import-submit]')
        await pg.wait_for_selector('.callout.error')
        check('Chess.com link gives a clear message', 'blocks' in await pg.inner_text('.callout.error'))
        check('no page errors', not errs)
        if errs: print(errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
