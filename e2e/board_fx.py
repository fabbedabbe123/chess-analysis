import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
fails=[]
def check(name, cond):
    print(('PASS ' if cond else 'FAIL ')+name)
async def resign(pg):
    await goto_tab(pg,'Play'); await pg.wait_for_timeout(500)
    await pg.click('[data-testid=color-w]'); await pg.click('[data-testid=level-beginner]'); await pg.click('[data-testid=play-start]'); await pg.wait_for_selector('[data-testid=play-status]')
    await pg.click('[data-testid=play-resign]'); await pg.click('.modal button:has-text("Resign")')
    await pg.wait_for_selector('[data-testid=play-result]',timeout=15000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':1440,'height':900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        check('no effect before anything happens', await pg.locator('[data-testid=board-fx]').count()==0)
        await resign(pg)
        await pg.wait_for_selector('[data-testid=board-fx]',timeout=3000)
        check('resigning shows the "lose" effect', await pg.get_attribute('[data-testid=board-fx]','data-fx')=='lose')
        check('effect does not block the board', await pg.evaluate("getComputedStyle(document.querySelector('[data-testid=board-fx]')).pointerEvents")=='none')
        await pg.wait_for_timeout(1800)
        check('effect disappears again', await pg.locator('[data-testid=board-fx]').count()==0)
        # animations off -> nothing
        await pg.evaluate("""()=>{const k='chess-analysis:settings:v1';const s=JSON.parse(localStorage.getItem(k)||'{}');s.winAnimations=false;localStorage.setItem(k,JSON.stringify(s));}""")
        await pg.reload(); await pg.wait_for_selector('cg-board')
        await resign(pg); await pg.wait_for_timeout(600)
        check('no effect when the setting is off', await pg.locator('[data-testid=board-fx]').count()==0)
        check('no page errors', errs==[])
        await b.close()
asyncio.run(main())
