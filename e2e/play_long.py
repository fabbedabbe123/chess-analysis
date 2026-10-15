import asyncio, os, re, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
exec(open(os.path.join(os.path.dirname(__file__),'play.py')).read().split("async def main")[0].split("exec(open")[1].split("\n",1)[1])
# user plays a scripted weak line as White: 1.e4 ... then hangs things. We read the legal moves from the page via chess.js exposed on the board? use FEN from the move list instead.
async def fen(pg): return await pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('chess-analysis:game:v1')||'null'); return null })()")
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await goto_tab(pg,'Play')
        await pg.click('[data-testid=opt-practice]')  # competitive: no take back
        print('practice off -> takeback buttons:', await pg.locator('[data-testid=play-takeback]').count())
        await start(pg,'w','easy')
        print('takeback hidden in competitive mode:', await pg.locator('[data-testid=play-takeback]').count()==0)
        # scripted blunder-ish line; each move tried, skip if illegal (board ignores)
        script=['e2e4','d1h5','h5f7','f1c4','g1f3','b1c3','d2d3','c1g5','e1g1','f3g5','c4f7','h2h4','a2a3','a1b1']
        i=0
        for mv in script:
            if await pg.locator('[data-testid=play-result]').count(): break
            await pg.wait_for_function("document.querySelector('[data-testid=play-status]')===null || document.querySelector('[data-testid=play-status]').innerText.includes('Your move')",timeout=30000)
            if await pg.locator('[data-testid=play-result]').count(): break
            n=await plies(pg); await play(pg,mv); await pg.wait_for_timeout(300)
            if await plies(pg)>n:
                try: await wait_plies(pg,n+2,25000)
                except Exception: pass
        print('plies reached', await plies(pg))
        if not await pg.locator('[data-testid=play-result]').count():
            await pg.click('[data-testid=play-resign]'); await pg.click('.modal button:has-text("Resign")')
        await pg.wait_for_selector('[data-testid=play-result]'); print('result:', await pg.inner_text('[data-testid=play-result]'))
        await pg.click('[data-testid=play-analyze]'); await pg.wait_for_selector('[data-testid=play-report]',timeout=240000)
        print('accuracy:', await pg.inner_text('[data-testid=acc-you]'), '| cards:', await pg.locator('[data-testid=coach-card]').count(), '| key moments:', await pg.locator('[data-testid=key-moment]').count(), '| recs:', await pg.locator('[data-testid=play-recs] li').count())
        print((await pg.inner_text('[data-testid=play-report]'))[:1800])
        await pg.screenshot(path='/tmp/claude-0/play_report.png')
        if await pg.locator('[data-testid=play-session]').count():
            await pg.click('[data-testid=play-session]'); await pg.wait_for_timeout(1500); await pg.screenshot(path='/tmp/claude-0/sess.png'); print('LOGS0',logs); await pg.wait_for_selector('[data-testid=puzzle-active]',timeout=5000); print('puzzle session started:', await pg.inner_text('[data-testid=puzzle-message]'))
        print('LOGS',logs); await b.close()
asyncio.run(main())
