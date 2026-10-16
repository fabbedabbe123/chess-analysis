import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def check(name, cond): print(('PASS ' if cond else 'FAIL ')+name)
INSTR = """(()=>{window.__snd={buf:0,osc:0};const A=window.AudioContext;
 window.AudioContext=class extends A{createBufferSource(){window.__snd.buf++;return super.createBufferSource()}createOscillator(){window.__snd.osc++;return super.createOscillator()}};})();"""
async def tap_sq(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    await pg.touchscreen.tap(box['x']+(f+.5)*s, box['y']+(7-r+.5)*s)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        ctx=await b.new_context(viewport={'width':390,'height':800}, has_touch=True, is_mobile=True)
        await ctx.add_init_script(INSTR)
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board')
        # an old build stored soundEnabled:false: it must not silence the new setting
        await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({soundEnabled:false}))")
        await pg.reload(); await pg.wait_for_selector('cg-board')
        await tap_sq(pg,'e2'); await pg.wait_for_timeout(100); await tap_sq(pg,'e4'); await pg.wait_for_timeout(500)
        n=await pg.evaluate("window.__snd")
        check(f'a move makes a sound (buffer sources: {n["buf"]})', n['buf']>=1)
        await tap_sq(pg,'e7'); await pg.wait_for_timeout(100); await tap_sq(pg,'e5'); await pg.wait_for_timeout(300)
        await tap_sq(pg,'d2'); await pg.wait_for_timeout(100); await tap_sq(pg,'d4'); await pg.wait_for_timeout(300)
        await tap_sq(pg,'e5'); await pg.wait_for_timeout(100); await tap_sq(pg,'d4'); await pg.wait_for_timeout(500)  # capture
        n2=await pg.evaluate("window.__snd")
        check(f'a capture makes a sound too (buffer sources {n["buf"]} -> {n2["buf"]})', n2['buf']>n['buf']+2)
        # Play tab on a phone: colour and start position are selectable
        await pg.click('.mobile-tabs >> text=Play'); await pg.wait_for_selector('[data-testid=color-b]')
        check('Colour buttons visible on a phone', await pg.locator('[data-testid=color-b]').is_visible())
        check('Start-from buttons visible on a phone', await pg.locator('[data-testid=from-fen]').is_visible())
        await pg.tap('[data-testid=color-b]'); await pg.tap('[data-testid=from-fen]'); await pg.wait_for_timeout(200)
        check('tapping Black selects it', await pg.get_attribute('[data-testid=color-b]','aria-checked')=='true')
        check('tapping FEN selects it and shows the input', await pg.get_attribute('[data-testid=from-fen]','aria-checked')=='true' and await pg.locator('[data-testid=from-fen-input]').is_visible())
        check('no page errors', errs==[])
        await b.close()
asyncio.run(main())
