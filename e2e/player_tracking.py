import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGN = '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2026.10.01"]\n[White "Fabian"]\n[Black "Opp"]\n[Result "1-0"]\n[ECO "C23"]\n[ECOUrl "https://www.chess.com/openings/Bishops-Opening-1...e5"]\n[TimeControl "180"]\n[Termination "Fabian won by checkmate"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:03:00]} 2. Bc4 {[%clk 0:02:58.4]} 2... Nc6 {[%clk 0:02:59]} 3. Qh5 {[%clk 0:02:55]} 3... Nf6 {[%clk 0:02:50]} 4. Qxf7# {[%clk 0:02:50]} 1-0'
def g(i, color, res, tc='blitz'):
    me={'username':'Fabian','rating':1200+i*10,'result':res}; op={'username':'Opp%d'%i,'rating':1250,'result':'resigned' if res=='win' else 'win'}
    return {'url':'https://www.chess.com/game/live/%d'%i,'end_time':1790000000+i*1000,'time_class':tc,'rules':'chess','pgn':PGN,'white':me if color=='w' else op,'black':op if color=='w' else me}
ARCH='https://api.chess.com/pub/player/fabian/games/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        async def route(r):
            u=r.request.url; cors={'access-control-allow-origin':'*','content-type':'application/json'}
            if u.endswith('/player/nobody/games/archives'): return await r.fulfill(status=404,headers=cors,body='{}')
            if u.endswith('/player/fabian/games/archives'): return await r.fulfill(headers=cors,body=json.dumps({'archives':[ARCH+'2026/09',ARCH+'2026/10']}))
            if u.endswith('2026/10'): return await r.fulfill(headers=cors,body=json.dumps({'games':[g(i,'w' if i%2 else 'b','win' if i%3 else 'checkmated') for i in range(1,8)]}))
            if u.endswith('2026/09'): return await r.fulfill(headers=cors,body=json.dumps({'games':[g(0,'w','win')]}))
            await r.abort()
        await pg.route('https://api.chess.com/**',route)
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Player').click()
        await pg.fill('[data-testid=player-input]','nobody'); await pg.click('[data-testid=player-track]')
        await pg.wait_for_selector('[data-testid=player-error]'); print('unknown user ->', await pg.inner_text('[data-testid=player-error]'))
        await pg.fill('[data-testid=player-input]','Fabian'); await pg.click('[data-testid=player-track]')
        await pg.wait_for_selector('[data-testid=player-stats]'); print('stats:', (await pg.inner_text('[data-testid=player-stats]')).replace('\n',' | ')[:400])
        print('chart:', await pg.locator('[data-testid=rating-chart]').count(), 'openings rows:', await pg.locator('[data-testid=player-openings] tbody tr').count())
        await pg.locator('.player-panel .moment').first.click(); await pg.wait_for_timeout(500)
        await pg.screenshot(path='/tmp/claude-0/player.png')
        print('moves loaded:', await pg.evaluate("document.querySelectorAll('.mv').length"))
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Player').click()
        print('persisted after reload:', await pg.locator('[data-testid=player-stats]').count()==1)
        await pg.set_viewport_size({'width':390,'height':800}); await pg.wait_for_timeout(300)
        print('mobile overflow:', await pg.evaluate("document.documentElement.scrollWidth>innerWidth+1"))
        print('LOGS',logs); await b.close()
asyncio.run(main())
