import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGNS=json.load(open(os.path.join(os.path.dirname(__file__),'strength_pgns.json')))  # synthetic 44-ply games: a real opening, then random legal moves (so book moves do not hide the loss)
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.wait_for_selector('cg-board')
        await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:8}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('tab',name='Strength').click()
        check('empty state before any game', await pg.locator('[data-testid=strength-empty]').count()==1)
        for i,pgn in enumerate(PGNS):
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',pgn); await pg.click('[data-testid=import-submit]')
            await pg.wait_for_timeout(400)
            if await pg.get_by_role('button',name='Replace game').count(): await pg.get_by_role('button',name='Replace game').click()
            await pg.wait_for_selector('[data-testid=count-white]:not([disabled])',timeout=120000)
            await pg.click('[data-testid=count-white]')
            await pg.wait_for_timeout(200)
            if i==0:
                check('count button reports it was counted', 'Counted' in await pg.inner_text('[data-testid=count-strength]'))
        await pg.get_by_role('tab',name='Strength').click()
        check('estimate shown', await pg.locator('[data-testid=strength-range]').count()==1)
        print('range:', await pg.inner_text('[data-testid=strength-range]'), '|', await pg.inner_text('[data-testid=strength-confidence]'))
        check('3 games in the list', await pg.locator('[data-testid=strength-games] li').count()==3)
        check('focus list or too-few message visible', await pg.locator('[data-testid=focus-list]').count()+await pg.locator('.muted:has-text("No categorised")').count()==1)
        if await pg.locator('[data-testid=plan]').count(): 
            print('plan:', (await pg.inner_text('[data-testid=plan]')).replace('\n',' | ')[:200])
            first=pg.locator('[data-testid^=plan-lesson-]').first
            if await first.count():
                await first.click(); await pg.wait_for_selector('[data-testid=skill-detail]',timeout=5000)
                check('plan lesson opens the lesson', True)
                await pg.get_by_role('tab',name='Strength').click()
        await pg.screenshot(path='/tmp/claude-0/strength1440.png')
        # train my mistakes: real saved mistakes -> real puzzle on the board
        saved=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')"))
        n_saved=sum(len(g.get('mistakes',[])) for g in saved)
        print('saved mistakes:', n_saved)
        check('mistakes were saved with the analysed games', n_saved>0)
        check('train card offered', await pg.locator('[data-testid=train-start]').count()==1)
        await pg.click('[data-testid=train-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]',timeout=8000)
        fen=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
        check('puzzle board shows a saved mistake position', any(m['fen'].split()[0]==fen.split()[0] for g in saved for m in g.get('mistakes',[])))
        await pg.get_by_role('button',name='Exit puzzles').click()
        await pg.get_by_role('tab',name='Strength').click()
        # persistence
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Strength').click()
        check('estimate survives reload', await pg.locator('[data-testid=strength-range]').count()==1)
        # batch with a seeded tracker (analysis is real; the tracked games are example input, the Chess.com API is not reachable here)
        seeded={'username':'tester','games':[{'url':f'https://example.test/g{i}','endTime':1700000000+i,'timeClass':'blitz','color':'w','outcome':'loss','reason':'resigned','opponent':'opp','rating':1100+i,'opponentRating':1150,'eco':None,'opening':None,'pgn':PGNS[i]} for i in range(2)],'fetchedMonths':[],'allArchives':[],'lastSync':1}
        await pg.evaluate("v=>localStorage.setItem('chess-analysis:tracker:v1', v)", json.dumps(seeded)); await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.get_by_role('tab',name='Strength').click()
        check('batch panel offered', await pg.locator('[data-testid=batch-start]').count()==1)
        await pg.select_option('[data-testid=batch-count]','3'); await pg.click('[data-testid=batch-start]')
        await pg.wait_for_selector('[data-testid=batch-note]',timeout=180000)
        print('note:', await pg.inner_text('[data-testid=batch-note]'))
        check('batch analysed both tracked games', 'Analysed 2' in await pg.inner_text('[data-testid=batch-note]'))
        check('compare-with-rating line appears', await pg.locator('[data-testid=strength-compare]').count()==1)
        # remove all
        await pg.click('.card-details summary'); await pg.click('[data-testid=strength-clear]'); await pg.get_by_role('button',name='Remove all').last.click()
        await pg.wait_for_timeout(300)
        check('cleared', await pg.locator('[data-testid=strength-empty]').count()==1)
        check('no page errors', not errs)
        if errs: print(errs[:5])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
