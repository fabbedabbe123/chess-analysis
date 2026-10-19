import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def ok(c,t):
    print(('PASS ' if c else 'FAIL ')+t)
    if not c: ok.bad+=1
ok.bad=0
async def w(pg): return round((await pg.locator('cg-board').bounding_box())['width'])
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1600,'height':1000})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        auto=await w(pg)
        h=pg.get_by_test_id('board-resize'); box=await h.bounding_box(); cx,cy=box['x']+box['width']/2, box['y']+box['height']/2
        await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx-60,cy-60,steps=5); await pg.mouse.up(); await pg.wait_for_timeout(300)
        small=await w(pg); ok(small<auto, f'dragging the corner inwards shrinks the board ({auto} -> {small})')
        box=await h.bounding_box(); cx,cy=box['x']+box['width']/2, box['y']+box['height']/2
        await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx+80,cy+80,steps=5); await pg.mouse.up(); await pg.wait_for_timeout(300)
        big=await w(pg); ok(big>small, f'dragging outwards grows it ({small} -> {big})')
        box=await h.bounding_box(); cx,cy=box['x']+box['width']/2, box['y']+box['height']/2
        await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx+900,cy+900,steps=5); await pg.mouse.up(); await pg.wait_for_timeout(300)
        huge=await w(pg); ok(huge>big and huge<=1000-150, f'grows further but the window limits the size ({big} -> {huge})')
        ok(await pg.evaluate("document.documentElement.scrollHeight<=innerHeight+1"), 'no page scroll at the largest size')
        await pg.reload(); await pg.wait_for_selector('cg-board'); ok(abs(await w(pg)-huge)<=2, 'size is remembered after reload')
        await pg.get_by_test_id('board-resize').dblclick(); await pg.wait_for_timeout(300)
        ok(abs(await w(pg)-auto)<=2, f'double-click resets to the automatic size ({await w(pg)})')
        m=await (await b.new_context(viewport={'width':390,'height':800})).new_page(); await m.goto(URL); await m.wait_for_selector('cg-board')
        ok(not await m.get_by_test_id('board-resize').is_visible(), 'no resize handle on a phone')
        ok(not errs, f'no page errors {errs[:2]}')
        await b.close()
    print('FAILED' if ok.bad else 'ALL PASSED'); raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
