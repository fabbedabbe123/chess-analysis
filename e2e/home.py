import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
GAME='[Event "x"]\n[White "Fabian"]\n[Black "Opp"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *'
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(BASE_URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('[data-testid=home]')
        check('fresh visit shows the start page, not the workspace', await pg.locator('cg-board').count()==0)
        check('three ways in', await pg.locator('.home-card').count()==3)
        check('nothing to pick up on a fresh visit', await pg.locator('.home-continue').count()==0)
        await pg.screenshot(path='/tmp/claude-0/home_fresh.png')
        # Analyse -> workspace with import dialog
        await pg.click('[data-testid=home-analyse]'); await pg.wait_for_selector('textarea.import-text')
        check('analyse opens the workspace and the import dialog', await pg.locator('cg-board').count()==1)
        await pg.fill('textarea.import-text',GAME); await pg.click('[data-testid=import-submit]'); await pg.wait_for_timeout(1500)
        # reload with a game open: straight to the workspace
        await pg.reload(); await pg.wait_for_selector('cg-board')
        check('with a game open the workspace opens directly', await pg.locator('[data-testid=home]').count()==0)
        # back to the start page: the game is offered
        await pg.click('[data-testid=go-home]'); await pg.wait_for_selector('[data-testid=home]')
        txt=await pg.inner_text('[data-testid=home-continue-game]'); print(txt.replace('\n',' | '))
        check('start page offers the game on the board', 'Fabian' in txt and '4 half-moves' in txt)
        await pg.click('[data-testid=home-continue-game]'); await pg.wait_for_selector('cg-board')
        check('continue returns to the same game', await pg.locator('.moves-flow .mv').count()==4)
        # My games and Play cards pick the right tab
        await pg.click('[data-testid=go-home]'); await pg.click('[data-testid=home-games]'); await pg.wait_for_selector('cg-board')
        check('My games card opens the Player tab', await pg.locator('.p-player').is_visible())
        await pg.click('[data-testid=go-home]'); await pg.click('[data-testid=home-play]'); await pg.wait_for_selector('cg-board')
        check('Play card opens Play', await pg.locator('.p-play').is_visible())
        # strength + due puzzles rows from saved data
        sg=[{'id':'a','source':'import','endedAt':1700000000,'userColor':'w','label':'g','moves':40,'acpl':60,'accuracy':80,'counts':{},'catCount':{},'catLoss':{},'myRating':None,'depth':10,'mistakes':[]}]
        await pg.evaluate("v=>localStorage.setItem('chess-analysis:strength-games:v1', v)", json.dumps(sg))
        await pg.evaluate("""()=>localStorage.setItem('chess-analysis:puzzles:v1', JSON.stringify({solved:{p001:{attempts:1,clean:true}},streak:0,bestStreak:0,srs:{p001:{box:1,due:1}}}))""")
        await pg.goto(BASE_URL); await pg.evaluate("localStorage.removeItem('chess-analysis:game:v1')")
        await pg.evaluate("Object.keys(localStorage).forEach(k=>{ if(k.includes('game') && !k.includes('strength')) localStorage.removeItem(k) })")
        await pg.reload(); await pg.wait_for_selector('[data-testid=home]')
        check('estimated level shown on the start page', await pg.locator('[data-testid=home-strength]').count()==1)
        check('due puzzles shown on the start page', await pg.locator('[data-testid=home-due]').count()==1)
        await pg.click('[data-testid=home-due]'); await pg.wait_for_selector('cg-board')
        check('due puzzles card opens the Puzzles tab', await pg.locator('.p-puzzles').is_visible())
        # mobile layout
        m=await (await b.new_context(viewport={'width':390,'height':844})).new_page()
        await m.goto(BASE_URL); await m.wait_for_selector('[data-testid=home]')
        check('no horizontal scroll on mobile', not await m.evaluate('document.documentElement.scrollWidth>innerWidth'))
        await m.screenshot(path='/tmp/claude-0/home_mobile.png')
        check('no page errors', not errs)
        if errs: print(errs[:3])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
