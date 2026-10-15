import asyncio
from playwright.async_api import async_playwright
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'common.py')).read())
PGN='''[Event "Round trip"]
[White "Ünï Cödé"]
[Black "B \\"quoted\\""]
[Result "0-1"]

1. e4 {[%clk 0:03:00] book} e5 $1 2. Nf3 (2. f4 $6 exf4 3. Nf3 (3. Bc4 Qh4+) 3... g5) 2... Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Qe2 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 0-1
'''
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
        pg=await ctx.new_page(); logs=[]; pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        async def imp(text):
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',text); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(400)
            if await pg.get_by_role('button',name='Replace game').count(): await pg.get_by_role('button',name='Replace game').click()
            if await pg.locator('.modal').count(): await pg.get_by_text('Load selected game').click(); await pg.wait_for_timeout(300)
        await imp(PGN)
        m1=await pg.locator('.move-list .mv').all_inner_texts(); v1=await pg.locator('.variation').count()
        # add NAG + comment through the UI on selected move
        await pg.locator('.mv',has_text='Nf6').first.click()
        await pg.get_by_role('button',name='!?',exact=True).click()
        await pg.fill('textarea.comment-box','my "note" {with braces}'); await pg.locator('textarea.comment-box').blur(); await pg.wait_for_timeout(200)
        async with pg.expect_download() as dl: await pg.get_by_text('Download PGN').click()
        d=await dl.value; path=await d.path(); text=open(path,encoding='utf8').read()
        print('--- exported PGN ---\n'+text)
        # fresh page re-import
        pg2=await ctx.new_page(); await pg2.goto(URL); await pg2.wait_for_selector('cg-board'); await pg2.evaluate("localStorage.clear()"); await pg2.reload(); await pg2.wait_for_selector('cg-board')
        pg=pg2
        await imp(text)
        m2=await pg.locator('.move-list .mv').all_inner_texts(); v2=await pg.locator('.variation').count()
        m1b=[x.replace('!?','') for x in m1]
        print('moves equal (ignoring added NAG):', [x.replace('!?','') for x in m2]==m1b, 'variations', v1, v2)
        print('comments:', await pg.locator('.mv-comment').all_inner_texts())
        print('headers kept:', await pg.evaluate("1"), )
        await pg.locator('details.headers summary').click(); print('White:',await pg.locator('details.headers input').nth(0).input_value(),'| Black:',await pg.locator('details.headers input').nth(1).input_value())
        # restore original
        await pg.locator('.mv',has_text='Nf6').first.click(); await pg.get_by_text('Delete from here').click(); await pg.wait_for_timeout(200)
        n_after=await pg.locator('.move-list .mv').count()
        await pg.get_by_text('Restore imported game').click(); await pg.wait_for_timeout(300)
        print('after delete', n_after, 'after restore', await pg.locator('.move-list .mv').count())
        # library
        await pg.fill('input[aria-label="Title for the saved game"]','audit game'); await pg.get_by_role('button',name='Save',exact=True).click()
        print('library items', await pg.locator('.library li').count())
        await pg.get_by_text('New game').first.click()
        if await pg.get_by_role('button',name='New game').count()>1: await pg.get_by_role('button',name='New game').last.click()
        print('after new game moves', await pg.locator('.move-list .mv').count())
        await pg.locator('.lib-item').first.click(); await pg.wait_for_timeout(300)
        print('after lib load', await pg.locator('.move-list .mv').count())
        await pg.get_by_label('Delete audit game').click(); print('after lib delete', await pg.locator('.library li').count())
        # copy buttons
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        await pg.get_by_text('Copy FEN').click(); await pg.wait_for_timeout(200)
        print('clipboard FEN:', await pg.evaluate('navigator.clipboard.readText()'))
        await pg.get_by_text('Copy PGN').click(); await pg.wait_for_timeout(200)
        print('clipboard PGN starts:', (await pg.evaluate('navigator.clipboard.readText()'))[:40].replace('\n',' '))
        # bad imports
        for bad in ['', 'hello world', '1. e4 e5 2. Qxx9', '[Event "x"]\n\n*']:
            await pg.click('[data-testid=open-import]'); await pg.fill('textarea.import-text',bad); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(250)
            print(repr(bad[:20]),'->',(await pg.locator('.modal .callout').all_inner_texts())[:1], 'games', await pg.locator('.choice').count()); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        print('LOGS',logs); await b.close()
asyncio.run(main())
