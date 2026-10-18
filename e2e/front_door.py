import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PGNS=json.load(open(os.path.join(os.path.dirname(__file__),'strength_pgns.json')))  # synthetic 44-ply games
ARCH='https://api.chess.com/pub/player/tester/games/'
def g(i):
    me={'username':'Tester','rating':1200,'result':'win' if i%2 else 'checkmated'}; op={'username':'Opp%d'%i,'rating':1250,'result':'checkmated' if i%2 else 'win'}
    return {'url':'https://www.chess.com/game/live/%d'%i,'end_time':1790000000+i*1000,'time_class':'blitz','rules':'chess','pgn':PGNS[i%len(PGNS)],'white':me,'black':op}
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        async def route(r):
            u=r.request.url; cors={'access-control-allow-origin':'*','content-type':'application/json'}
            if u.endswith('/player/tester/games/archives'): return await r.fulfill(headers=cors,body=json.dumps({'archives':[ARCH+'2026/10']}))
            if u.endswith('2026/10'): return await r.fulfill(headers=cors,body=json.dumps({'games':[g(i) for i in range(6)]}))
            await r.abort()
        await pg.route('https://api.chess.com/**',route)
        await pg.goto(BASE_URL); await pg.evaluate("localStorage.clear(); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({reviewDepth:8}))"); await pg.reload(); await pg.wait_for_selector('[data-testid=home]')
        check('home has no sign-in box above the headline', await pg.locator('[data-testid=signin-banner]').count()==0 and await pg.locator('.home-top [data-testid=account-open]').count()==0)
        check('no build stamp floating on the page', await pg.locator('.version-badge').count()==0)
        await pg.reload(); await pg.wait_for_selector('[data-testid=site-footer]')
        for label,title in [('About','About'),('Support','Support'),('Privacy','Privacy'),('Credits & licences','Credits and licences')]:
            await pg.locator('[data-testid=site-footer]').get_by_text(label,exact=True).click()
            check(f'footer {label} opens its page', await pg.get_by_role('dialog').get_by_text(title).count()>0)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check('footer shows the copyright and no source-code link', '©' in await pg.inner_text('[data-testid=site-footer]') and 'Source code' not in await pg.inner_text('[data-testid=site-footer]'))
        await pg.fill('[data-testid=find-name]','tester'); await pg.click('[data-testid=find-go]')
        await pg.wait_for_selector('cg-board',timeout=15000)
        check('submitting opens the Strength tab', await pg.get_by_role('tab',name='Strength',exact=True).get_attribute('aria-selected')=='true')
        await pg.wait_for_function("document.querySelectorAll('[data-testid=strength-games] li').length>=3",timeout=180000)
        check('first games analysed automatically, report appears', await pg.locator('[data-testid=focus-list]').count()+await pg.locator('[data-testid=focus-too-few]').count()>=1)
        await pg.wait_for_function("document.querySelectorAll('[data-testid=strength-games] li').length>=6",timeout=180000)
        n=await pg.locator('[data-testid=strength-games] li').count(); check('all 6 mocked games analysed (batch of up to 20)', n==6)
        check('focus areas shown with 6 games', await pg.locator('[data-testid=focus-list] li').count()>=1)
        await pg.click('[data-testid=open-help]'); await pg.wait_for_selector('[data-testid=version-badge]')
        check('build stamp lives in Help → About', 'Version:' in await pg.inner_text('[data-testid=version-badge]'))
        check('no page errors', not errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
