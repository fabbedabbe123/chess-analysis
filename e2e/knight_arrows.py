import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def check(name, cond): print(('PASS ' if cond else 'FAIL ')+name)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page()
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        box=await pg.locator('cg-board').bounding_box(); sq=box['width']/8
        def c(f,r): return box['x']+(f+.5)*sq, box['y']+(7-r+.5)*sq
        async def arrow(a,z):
            await pg.mouse.move(*c(*a)); await pg.mouse.down(button='right'); await pg.mouse.move(*c(*z),steps=5); await pg.mouse.up(button='right')
        await arrow((6,0),(5,2)); await pg.wait_for_timeout(300)   # g1 -> f3: knight
        shapes=lambda: pg.evaluate("()=>[...document.querySelectorAll('svg.cg-shapes path[marker-end]')].map(p=>p.getAttribute('d'))")
        check('knight arrow is an L (two straight segments)', any(d.count('L')==2 and d.startswith('M 2.5 3.5 L 2.5 1.5') for d in await shapes()))
        n_before=await pg.evaluate("document.querySelectorAll('svg.cg-shapes line[marker-end]').length")
        await arrow((0,1),(0,3)); await pg.wait_for_timeout(300)   # a2 -> a4: straight
        check('a straight arrow stays a straight line', await pg.evaluate("document.querySelectorAll('svg.cg-shapes line[marker-end]').length")>n_before)
        await b.close()
asyncio.run(main())
