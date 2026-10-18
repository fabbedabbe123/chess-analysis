import asyncio, json, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def ok(c,t):
    print(('PASS ' if c else 'FAIL ')+t)
    if not c: ok.bad+=1
ok.bad=0

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await goto_tab(pg,'Learn'); await pg.wait_for_selector('[data-testid=learn-path]')
        ok('Up next' in await pg.inner_text('.path-node.st-next'), 'one skill is marked Up next')
        ok(await pg.locator('.path-node.st-locked').count()>0, 'later skills are locked')
        # locked skills can still be opened, with a note
        await pg.locator('.path-node.st-locked').first.click(); await pg.wait_for_selector('[data-testid=skill-detail]')
        ok(await pg.locator('[data-testid=locked-note]').count()==1, 'locked skill shows what comes first')
        await pg.click('[data-testid=learn-back]')
        # a new skill without hand-written exercises: practice only
        await pg.click('[data-testid=skill-mate-in-1]'); await pg.wait_for_selector('[data-testid=practice-card]')
        ok(await pg.locator('[data-testid=lesson-start]').count()==0, 'practice-only skill has no lesson button')
        await pg.wait_for_function("!document.querySelector('[data-testid=practice-start]').disabled")
        await pg.click('[data-testid=practice-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        ok(await pg.get_by_role('tab',name='Puzzles').get_attribute('aria-selected')=='true', 'practice opens in the Puzzles tab')
        await pg.get_by_role('button',name='Exit puzzles').click(); await goto_tab(pg,'Learn'); await pg.wait_for_selector('[data-testid=skill-detail]')
        await pg.click('[data-testid=learn-back]')
        # placement test
        await pg.click('[data-testid=placement-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        stored=await pg.evaluate("JSON.parse(localStorage.getItem('chess-analysis:placement:v1')||'null')")
        ok(stored is not None and len(stored['sampled'])==10, 'placement test samples 10 positions')
        await pg.get_by_role('button',name='Exit puzzles').click(); await goto_tab(pg,'Learn'); await pg.wait_for_selector('[data-testid=placement-card]')
        # daily practice
        await pg.click('[data-testid=daily-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        ok(True, 'daily practice starts')
        await pg.get_by_role('button',name='Exit puzzles').click(); await goto_tab(pg,'Learn'); await pg.wait_for_selector('[data-testid=daily-card]')
        await pg.screenshot(path='/tmp/claude-0/path_desktop.png')
        ok(not logs, f'no page errors {logs[:3]}')
        await b.close()
    print('FAILED' if ok.bad else 'ALL PASSED'); raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
