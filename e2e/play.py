import asyncio, os, re
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
async def wait_plies(pg, n, t=30000):
    await pg.wait_for_function("n => document.querySelectorAll('.moves-flow .mv').length >= n", arg=n, timeout=t)
async def status(pg): return (await pg.inner_text('[data-testid=play-status]')).strip()
async def start(pg, color, level):
    await pg.click(f'[data-testid=color-{color}]'); await pg.click(f'[data-testid=level-{level}]'); await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # keep a user game to prove it is restored
        await play(pg,'e2e4'); await play(pg,'e7e5'); before=await plies(pg)
        await pg.get_by_role('tab',name='Play',exact=True).click()
        print('1) setup visible, levels:', await pg.locator('[data-testid^=level-]').count())
        # --- White vs Beginner
        await start(pg,'w','beginner')
        print('2) start as White:', await status(pg), '| plies', await plies(pg), '| orientation white:', not await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')"))
        await play(pg,'e2e4'); await wait_plies(pg,2)
        print('3) engine replied, plies:', await plies(pg), '| status:', await status(pg))
        # locked while thinking? try moving a pawn instantly after our move
        await pg.wait_for_function("document.querySelector('[data-testid=play-status]').innerText.includes('Your move')",timeout=20000)
        # hints
        await pg.click('[data-testid=play-hint-btn]'); await pg.wait_for_selector('[data-testid=play-hint]:has-text("Hint 1")',timeout=30000)
        await pg.click('[data-testid=play-hint-btn]'); await pg.click('[data-testid=play-hint-btn]'); await pg.wait_for_selector('[data-testid=hint-3]')
        print('4) hint3:', (await pg.inner_text('[data-testid=hint-3]')).replace('\n',' | '))
        hl=await pg.evaluate("document.querySelectorAll('cg-board square').length"); print('   highlighted squares on board:', hl)
        # eval + feedback
        print('5) eval text:', (await pg.inner_text('[data-testid=play-eval]'))[:120])
        # play a bad move deliberately: g4 (weakening) then check feedback appears
        fen_hint=await pg.inner_text('[data-testid=hint-3]')
        await play(pg,'g2g4'); await wait_plies(pg,4)
        await pg.wait_for_selector('[data-testid=play-feedback]',timeout=40000)
        print('6) feedback:', (await pg.inner_text('[data-testid=play-feedback]')).replace('\n',' | ')[:300])
        # take back
        n=await plies(pg); await pg.click('[data-testid=play-takeback]'); await pg.wait_for_timeout(500)
        print('7) takeback plies', n,'->', await plies(pg), '| status:', await status(pg))
        # illegal intrusion check: board keeps legal only
        await play(pg,'d2d4'); await wait_plies(pg,4)
        # draw offer
        await pg.wait_for_function("document.querySelector('[data-testid=play-status]').innerText.includes('Your move')",timeout=20000)
        await pg.click('[data-testid=play-draw]'); await pg.wait_for_timeout(4000)
        accepted=await pg.locator('[data-testid=play-result]').count()
        print('8) draw offer ->', 'accepted' if accepted else await status(pg))
        if not accepted:
            await pg.click('[data-testid=play-resign]')
            await pg.click('.modal button:has-text("Resign")')
        await pg.wait_for_selector('[data-testid=play-result]',timeout=15000)
        print('9) result:', await pg.inner_text('[data-testid=play-result]'))
        # analysis
        await pg.click('[data-testid=play-analyze]'); await pg.wait_for_selector('[data-testid=play-report]',timeout=180000)
        print('10) accuracy you:', await pg.inner_text('[data-testid=acc-you]'), '| coach cards:', await pg.locator('[data-testid=coach-card]').count(), '| key moments:', await pg.locator('[data-testid=key-moment]').count(), '| recs:', await pg.locator('[data-testid=play-recs] li').count())
        await pg.screenshot(path='/tmp/claude-0/play_report.png', full_page=False)
        if await pg.locator('[data-testid=key-moment]').count(): 
            await pg.locator('[data-testid=key-moment]').first.click(); print('    jumped to key moment ok')
        # new game as Black vs expert
        await pg.click('[data-testid=play-again]')
        await pg.wait_for_selector('[data-testid=play-status]'); print('11) new game status:', await status(pg))
        await pg.click('[data-testid=play-exit]'); 
        if await pg.locator('.modal button:has-text("Leave")').count(): await pg.click('.modal button:has-text("Leave")')
        await pg.wait_for_selector('[data-testid=play-start]')
        print('12) exit restored user game plies:', await plies(pg), 'expected', before)
        # --- Black
        await start(pg,'b','expert'); await wait_plies(pg,1,40000)
        print('13) as Black: engine opened, plies', await plies(pg), '| orientation black:', await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')"))
        # every level plays a legal move
        await pg.click('[data-testid=play-exit]')
        if await pg.locator('.modal button:has-text("Leave")').count(): await pg.click('.modal button:has-text("Leave")')
        for lvl in ['easy','intermediate','advanced','maximum']:
            await start(pg,'b',lvl); await wait_plies(pg,1,40000); print('14) level',lvl,'-> engine first move ok, plies', await plies(pg))
            await pg.click('[data-testid=play-exit]')
            if await pg.locator('.modal button:has-text("Leave")').count(): await pg.click('.modal button:has-text("Leave")')
        # dashboard
        print('15) dashboard:', (await pg.inner_text('[data-testid=play-dashboard]')).replace('\n',' | ')[:350])
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Play',exact=True).click()
        print('16) history persisted after reload:', 'Games' in await pg.inner_text('[data-testid=play-dashboard]'))
        print('LOGS',logs); await b.close()
asyncio.run(main())
