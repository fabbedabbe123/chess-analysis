import asyncio, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        for w,h,tag in [(1440,900,'desk'),(390,844,'phone')]:
            pg=await (await b.new_context(viewport={'width':w,'height':h})).new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e)))
            await pg.goto(BASE_URL+'?workspace'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(1200)
            check(f'{tag}: no tour pops up for automated browsers', await pg.locator('[data-testid=tour]').count()==0)
            await pg.goto(BASE_URL+'?workspace&tour'); await pg.wait_for_selector('[data-testid=tour-start]',timeout=5000)
            check(f'{tag}: first visit offers the tour', True)
            await pg.click('[data-testid=tour-start]')
            spots=0
            for i in range(9):
                await pg.wait_for_timeout(350)
                if await pg.locator('.tour-spot').count():
                    bx=await pg.locator('.tour-spot').bounding_box(); cb=await pg.locator('.tour-card').bounding_box()
                    if bx and bx['width']>10: spots+=1
                    inside = cb['x']>=0 and cb['y']>=0 and cb['x']+cb['width']<=w+1 and cb['y']+cb['height']<=h+1
                    if not inside: print('card outside screen at step',i+1,cb)
                    ok = ok and inside
                await pg.screenshot(path=f'/tmp/claude-0/tour_{tag}_{i+1}.png')
                await pg.click('[data-testid=tour-next]')
            check(f'{tag}: every step lights something up ({spots}/9)', spots==9)
            check(f'{tag}: the tour ends with the done card', await pg.locator('[data-testid=tour-import]').count()==1)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            check(f'{tag}: Esc closes it', await pg.locator('[data-testid=tour]').count()==0)
            await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(1200)
            check(f'{tag}: not offered again after answering', await pg.locator('[data-testid=tour]').count()==0)
            if tag=='desk':
                await pg.click('[aria-label="Help, tips and shortcuts"]'); await pg.click('[data-testid=help-tour]'); await pg.wait_for_timeout(300)
                check('Help can start the tour again', await pg.locator('.tour-spot').count()==1)
                await pg.click('[data-testid=tour-skip]')
                await pg.click('[data-testid=open-settings]'); await pg.click('[data-testid=settings-tour]'); await pg.wait_for_timeout(300)
                check('Settings can start the tour again', await pg.locator('.tour-spot').count()==1)
                await pg.click('[data-testid=tour-skip]')
            check(f'{tag}: no page errors', not errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
