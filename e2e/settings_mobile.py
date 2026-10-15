import asyncio
from playwright.async_api import async_playwright
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'common.py')).read())
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900}); pg=await ctx.new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({autoReviewOnImport:false}))"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text','1. e4 e5 2. Nf3 Nc6 3. Bb5 *'); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(500)
        await pg.wait_for_function("document.querySelector('.engine-panel').dataset.analysedFen===document.querySelector('.board-wrap').dataset.fen",timeout=60000)
        await pg.get_by_role('button',name='Stop',exact=True).click(); await pg.wait_for_timeout(300)
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(600)
        print('stopped+navigated: board fen changed vs analysed ->', await pg.evaluate("[document.querySelector('.board-wrap').dataset.fen.split(' ')[1], document.querySelector('.engine-panel').dataset.analysedFen]"), '| score shown:', await pg.inner_text('[data-testid=engine-score]'), '| bar', await pg.get_attribute('[data-testid=eval-bar]','aria-valuenow'))
        await pg.get_by_role('button',name='Start',exact=True).click()
        # settings persistence
        await pg.click('[data-testid=open-settings]')
        M=pg.locator('.modal'); sel=M.locator('select')
        await M.locator('label.field',has_text='Theme').locator('select').select_option('light'); await M.locator('label.field',has_text='Board').locator('select').select_option('brown'); await M.locator('label.field',has_text='Pieces').locator('select').select_option('merida'); await M.locator('label.field',has_text='Evaluation format').locator('select').select_option('centipawns')
        await pg.screenshot(path='shot_settings.png'); await pg.keyboard.press('Escape')
        await pg.reload(); await pg.wait_for_selector('cg-board')
        print('persisted:', await pg.evaluate("[document.documentElement.dataset.theme, document.querySelector('.board-wrap').className]"))
        await pg.wait_for_function("parseInt(document.querySelector('[data-testid=engine-depth]').textContent)>=8",timeout=60000)
        print('cp format score:', await pg.inner_text('[data-testid=engine-score]'))
        await pg.screenshot(path='shot_light.png')
        # pieces actually load (merida) - check background image resolves
        ok=await pg.evaluate("""async()=>{const p=document.querySelector('cg-board piece.white.pawn'); const u=getComputedStyle(p).backgroundImage.match(/url\\("?(.*?)"?\\)/)[1]; const r=await fetch(u); return [u,r.status,r.headers.get('content-type')]}""")
        print('piece asset:',ok)
        # all board themes/pieces load assets
        for set_ in ['cburnett','merida','chessnut','rhosgfx']:
            r=await pg.evaluate(f"fetch('/pieces/{set_}/wK.svg').then(r=>r.status)"); print(set_,r,end='; ')
        print()
        # tabs & dialogs
        for tab in ['Review','Openings','Tactics','Engine']: await goto_tab(pg,tab)
        await pg.click('text=Help, tips & shortcuts'); print('help dialog:', await pg.locator('.modal').count()); await pg.keyboard.press('Escape')
        # openings explorer error path (network blocked in sandbox)
        await goto_tab(pg,'Openings'); await pg.get_by_label('Load from explorer.lichess.ovh').check(); await pg.wait_for_timeout(3500)
        print('explorer:', await pg.locator('.openings-panel .callout.warn').all_inner_texts(), '| book moves still shown:', await pg.locator('.book-move').count())
        # mobile nav
        m=await b.new_page(viewport={'width':390,'height':800}); await m.goto(URL); await m.wait_for_selector('cg-board')
        bar=await m.locator('.mobile-tabs button').all_inner_texts(); print('mobile bar:',bar)
        for t in ['Analyse','Train','My games','Play','Menu','Board']:
            await m.locator('.mobile-tabs button',has_text=t).first.click(); await m.wait_for_timeout(150)
            vis=await m.evaluate("[...document.querySelectorAll('.col-left,.col-center,.col-right,.right-panels>div,.moves-panel')].filter(e=>e.offsetParent!==null).map(e=>e.className.split(' ')[0]).join(',')")
            hs=await m.evaluate('document.documentElement.scrollWidth>innerWidth'); print(f'mobile {t:8}',vis,'hscroll',hs)
        print('LOGS',logs); await b.close()
asyncio.run(main())
