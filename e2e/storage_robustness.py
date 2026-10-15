import asyncio
from playwright.async_api import async_playwright
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'common.py')).read())
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL)
        for key,val in [('chess-analysis:game:v1','{{{garbage'),('chess-analysis:settings:v1','{"boardTheme":"nope","multiPv":999,"analysisDepth":"x"}'),('chess-analysis:library:v1','[1,2,null]')]:
            await pg.evaluate("([k,v])=>localStorage.setItem(k,v)",[key,val])
        await pg.reload(); await pg.wait_for_selector('cg-board',timeout=10000)
        print('survived corrupt storage; pieces', await pg.locator('cg-board piece').count(), '| class', await pg.evaluate("document.querySelector('.board-wrap').className"))
        await pg.wait_for_function("parseInt(document.querySelector('[data-testid=engine-depth]').textContent)>=6",timeout=60000)
        print('lines with clamped multipv:', await pg.locator('[data-testid=pv-line]').count())
        ctx2=await b.new_context(); p2=await ctx2.new_page(); await p2.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        errs=[]; p2.on('pageerror',lambda e: errs.append(str(e)))
        await p2.goto(URL); await p2.wait_for_selector('cg-board',timeout=10000); print('works with localStorage blocked; page errors:', errs)
        print('LOGS',logs); await b.close()
asyncio.run(main())
