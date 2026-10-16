import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def check(name, cond): print(('PASS ' if cond else 'FAIL ')+name)
async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    await pg.mouse.click(*await sq_xy(pg,uci[:2])); await pg.wait_for_timeout(80); await pg.mouse.click(*await sq_xy(pg,uci[2:4])); await pg.wait_for_timeout(250)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        for m in ['f2f3','e7e5','g2g4']: await play(pg,m)
        check('no markers before mate', await pg.locator('[data-testid=mate-markers]').count()==0)
        await play(pg,'d8h4')  # Qh4#
        await pg.wait_for_selector('[data-testid=mate-markers]',timeout=3000)
        check('mated king (e1) gets the red marker', await pg.get_attribute('[data-testid=mate-king]','data-square')=='e1')
        check('mating piece (h4) gets the gold marker', await pg.get_attribute('[data-testid=mate-winner]','data-square')=='h4')
        await pg.wait_for_timeout(350)
        check('confetti around the mating piece', await pg.locator('[data-testid=mate-confetti] i').count()==18)
        box=await pg.locator('[data-testid=board]').bounding_box()
        await pg.screenshot(path='/tmp/claude-0/mate.png', clip={'x':box['x']-5,'y':box['y']-5,'width':box['width']+10,'height':box['height']+10})
        # marker sits on the right square: h4 = col 7 (white at the bottom), row 4 from the top
        pos=await pg.evaluate("""()=>{const w=document.querySelector('[data-testid=mate-winner]').getBoundingClientRect(),b=document.querySelector('cg-board').getBoundingClientRect();return [(w.left-b.left)/b.width*8,(w.top-b.top)/b.height*8]}""")
        check(f'winner marker is on h4 (col/row {pos[0]:.2f},{pos[1]:.2f})', abs(pos[0]-7)<0.05 and abs(pos[1]-4)<0.05)
        print('rects', await pg.evaluate("['.mate-layer','cg-board','.board-wrap','.cg-wrap'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,Math.round(r.left*10)/10,Math.round(r.top*10)/10,Math.round(r.width*10)/10,Math.round(r.height*10)/10]})"))
        await pg.wait_for_timeout(1800)
        check('confetti goes away, badges stay', await pg.locator('[data-testid=mate-confetti]').count()==0 and await pg.locator('[data-testid=mate-king]').count()==1)
        # flipping the board moves the markers with it
        await pg.keyboard.press('f'); await pg.wait_for_timeout(300)
        flip=await pg.evaluate("""()=>{const w=document.querySelector('[data-testid=mate-winner]').getBoundingClientRect(),b=document.querySelector('cg-board').getBoundingClientRect();return [(w.left-b.left)/b.width*8,(w.top-b.top)/b.height*8]}""")
        print('after flip', flip)
        # stepping back one move removes them
        await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(300)
        check('markers gone one move earlier', await pg.locator('[data-testid=mate-markers]').count()==0)
        check('no page errors', errs==[])
        await b.close()
asyncio.run(main())
