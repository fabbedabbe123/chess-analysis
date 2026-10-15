import asyncio, random
from playwright.async_api import async_playwright
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'common.py')).read())
G='1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
LONG='1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. Nc3 Qc7 13. Bg5 h6 14. Bh4 Re8 15. Rc1 Bf8 *'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        async def imp(t):
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',t); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(400)
            if await pg.get_by_role('button',name='Replace game').count(): await pg.get_by_role('button',name='Replace game').click()
            await pg.wait_for_timeout(300)
        # 1) review with mate
        await imp(G)
        await pg.get_by_role('tab',name='Review').click(); await pg.click('[data-testid=run-review]')
        await pg.wait_for_selector('[data-testid=accuracy-w]',timeout=120000)
        print('mate game accuracy W/B:', await pg.inner_text('[data-testid=accuracy-w]'), await pg.inner_text('[data-testid=accuracy-b]'))
        for t in await pg.locator('.moment').all_inner_texts(): print('  moment:', t.replace('\n',' | '))
        print('  badges:', await pg.locator('.move-list .badge').all_inner_texts())
        # review stale detection
        await pg.locator('.mv',has_text='Bc4').first.click(); await pg.keyboard.press('ArrowLeft')
        await pg.get_by_role('tab',name='Engine').click()
        # make new variation at start to see stale? main line change -> delete last
        await pg.locator('.mv',has_text='Qxf7#').first.click(); await pg.get_by_text('Delete from here').click(); await pg.get_by_role('tab',name='Review').click(); await pg.wait_for_timeout(200)
        print('stale warning shown:', await pg.locator('.callout.warn').count()>0)
        # 2) cancel review
        await imp(LONG); await pg.get_by_role('tab',name='Review').click()
        await pg.click('[data-testid=run-review]'); await pg.wait_for_timeout(1500)
        print('running progress:', await pg.locator('.progress span').inner_text()); await pg.get_by_role('button',name='Cancel').click(); await pg.wait_for_timeout(500)
        print('after cancel:', await pg.locator('.review-panel .muted.pad').all_inner_texts())
        # review again completes after a cancel
        await pg.click('[data-testid=run-review]'); await pg.wait_for_selector('[data-testid=accuracy-w]',timeout=180000)
        print('rerun after cancel OK', await pg.inner_text('[data-testid=accuracy-w]'))
        # 3) race test: rapid navigation
        await pg.get_by_role('tab',name='Engine').click()
        bad=0
        for trial in range(6):
            for _ in range(random.randint(8,25)): await pg.keyboard.press(random.choice(['ArrowLeft','ArrowRight','ArrowLeft']))
            await pg.wait_for_timeout(random.choice([0,50,200]))
            await pg.wait_for_function("document.querySelector('.engine-panel').dataset.analysedFen===document.querySelector('.board-wrap').dataset.fen && parseInt(document.querySelector('[data-testid=engine-depth]').textContent)>=8",timeout=60000)
            f=await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
            a=await pg.evaluate("document.querySelector('.engine-panel').dataset.analysedFen")
            if f!=a: bad+=1
        print('race trials mismatches:',bad)
        # 4) stop/start/restart
        await pg.get_by_role('button',name='Stop',exact=True).click(); await pg.wait_for_timeout(500)
        print('status after stop:', await pg.inner_text('[data-testid=engine-status]'))
        await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(600)
        print('stopped: analysed fen == board?', await pg.evaluate("document.querySelector('.engine-panel').dataset.analysedFen===document.querySelector('.board-wrap').dataset.fen"))
        await pg.get_by_role('button',name='Start',exact=True).click()
        await pg.wait_for_function("document.querySelector('.engine-panel').dataset.analysedFen===document.querySelector('.board-wrap').dataset.fen",timeout=60000); print('start OK')
        await pg.get_by_role('button',name='Restart',exact=True).click()
        await pg.wait_for_function("document.querySelector('.engine-panel').dataset.analysedFen===document.querySelector('.board-wrap').dataset.fen && parseInt(document.querySelector('[data-testid=engine-depth]').textContent)>=6",timeout=60000); print('restart OK', await pg.inner_text('[data-testid=engine-status]'))
        # MultiPV / mode changes
        await pg.get_by_label('Number of lines (MultiPV)').select_option('5'); await pg.wait_for_function("document.querySelectorAll('[data-testid=pv-line]').length===5",timeout=60000); print('multipv 5 OK')
        await pg.get_by_label('Analysis mode').select_option('time'); await pg.wait_for_timeout(2500); print('time mode status:', await pg.inner_text('[data-testid=engine-status]'))
        await pg.get_by_label('Analysis mode').select_option('infinite'); await pg.wait_for_timeout(2500); print('infinite status:', await pg.inner_text('[data-testid=engine-status]'), 'depth', await pg.inner_text('[data-testid=engine-depth]'))
        # strength limit
        await pg.click('[data-testid=open-settings]'); await pg.get_by_text('Limit playing strength').click(); await pg.keyboard.press('Escape'); await pg.get_by_label('Analysis mode').select_option('depth'); await pg.wait_for_timeout(3000)
        print('limited strength line:', await pg.locator('[data-testid=pv-line]').count(), await pg.inner_text('[data-testid=engine-status]'))
        print('LOGS',logs); await b.close()
asyncio.run(main())
