import asyncio, json, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
LES=json.load(open(os.path.join(os.path.dirname(__file__),'..','public','data','lessons.json')))
SK={s['id']:s for s in LES}

async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    x1,y1=await sq_xy(pg,uci[:2]); x2,y2=await sq_xy(pg,uci[2:4])
    await pg.mouse.click(x1,y1); await pg.wait_for_timeout(60); await pg.mouse.click(x2,y2); await pg.wait_for_timeout(150)
    if len(uci)==5 and await pg.locator('.promotion').count():
        await pg.get_by_label({'q':'Queen','r':'Rook','b':'Bishop','n':'Knight'}[uci[4]]).click()
    await pg.wait_for_timeout(250)
async def fen(pg): return await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")
async def msg(pg): return (await pg.locator('[data-testid=puzzle-message]').inner_text()).strip()
def ok(c,t):
    print(('PASS ' if c else 'FAIL ')+t)
    if not c: ok.bad+=1
ok.bad=0

async def solve_exercise(pg, ex, wrong_first=None):
    """Plays the solver moves of one exercise, waiting for the scripted replies."""
    await pg.wait_for_selector('[data-testid=puzzle-active]')
    start=await fen(pg)
    ok(start.split()[0]==ex['fen'].split()[0], f"{ex['id']}: board shows the exercise position")
    if wrong_first:
        await play(pg, wrong_first); await pg.wait_for_timeout(300)
        ok('idea this lesson teaches' in await msg(pg) or 'book move' in await msg(pg), f"{ex['id']}: wrong move rejected without engine ('{await msg(pg)}')")
        await pg.wait_for_timeout(1200)
        ok((await fen(pg)).split()[0]==ex['fen'].split()[0], f"{ex['id']}: wrong move taken back")
    for i in range(0,len(ex['solution']),2):
        await play(pg, ex['solution'][i])
        if i+1<len(ex['solution']): await pg.wait_for_timeout(900)
    await pg.wait_for_function("document.querySelector('[data-testid=lesson-why]')!==null", timeout=5000)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        for m in ['e2e4','e7e5']: await play(pg,m)
        game_fen=await fen(pg)
        await goto_tab(pg,'Learn')
        await pg.wait_for_selector('[data-testid=learn-summary]')
        n=await pg.locator('.skill-card').count()
        ok(n==len(LES), f'Learn lists all {len(LES)} skills (saw {n})')
        for cat,label in [('openings','Openings'),('endgames','Endgames'),('tactics','Tactics')]:
            await pg.get_by_role('button',name=label,exact=True).click()
            exp=sum(1 for s in LES if s['category']==cat)
            ok(await pg.locator('.skill-card').count()==exp, f'{label} filter shows {exp} skills')
        await pg.get_by_role('button',name='All',exact=True).click()
        # --- Forks lesson
        await pg.click('[data-testid=skill-forks]'); await pg.wait_for_selector('[data-testid=skill-detail]')
        first=SK['forks']['exercises'][0]
        lab0=await pg.inner_text('[data-testid=demo-label]'); a0=await pg.get_attribute('.lesson-demo svg','aria-label')
        await pg.get_by_label('Example: next move').click(); lab1=await pg.inner_text('[data-testid=demo-label]'); a1=await pg.get_attribute('.lesson-demo svg','aria-label')
        ok(lab0=='Start' and lab1=='Nf7+' and a0!=a1, f'worked example steps through the real solution ({lab0} -> {lab1})')
        await pg.screenshot(path='/tmp/claude-0/learn_detail.png')
        await pg.click('[data-testid=lesson-start]')
        await pg.wait_for_selector('[data-testid=puzzle-active]')
        ok(await pg.get_by_role('tab',name='Puzzles').get_attribute('aria-selected')=='true', 'lesson opens in the Puzzles tab')
        for idx,ex in enumerate(SK['forks']['exercises']):
            await solve_exercise(pg, ex, wrong_first='a2a3' if idx==0 else None)
            why=await pg.inner_text('[data-testid=lesson-why]'); ok(ex['why'][:30] in why, f"{ex['id']}: explanation shown after solving")
            last = idx==len(SK['forks']['exercises'])-1
            if last:
                await pg.click('[data-testid=lesson-finish]')
            else:
                await pg.click('[data-testid=puzzle-next]')
        await pg.wait_for_selector('[data-testid=skill-detail]')
        await pg.click('[data-testid=learn-back]'); await pg.wait_for_selector('[data-testid=learn-summary]')
        ok((await fen(pg))==game_fen, 'the real game is restored after the lesson')
        summ=await pg.inner_text('[data-testid=learn-summary]'); print('   ', summ)
        ok(f"{len(SK['forks']['exercises'])} of" in summ, 'summary counts the solved exercises')
        card=await pg.inner_text('[data-testid=skill-forks]'); ok('Practised' in card, f'forks is Practised (first exercise needed a retry): {card.splitlines()[-1] if card else ""}')
        # --- Najdorf (black) opening drill
        await pg.click('[data-testid=skill-najdorf]'); await pg.click('[data-testid=lesson-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        ex=SK['najdorf']['exercises'][0]
        ok(await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')"), 'Black drill: board is flipped to Black')
        await solve_exercise(pg, ex, wrong_first='b7b6')
        await pg.click('[data-testid=lesson-finish]'); await pg.wait_for_selector('[data-testid=skill-detail]'); await pg.click('[data-testid=learn-back]'); await pg.wait_for_selector('[data-testid=learn-summary]')
        # --- a stored back-rank mate: other moves are not accepted, even other mates
        await pg.click('[data-testid=skill-backrank]'); await pg.click('[data-testid=lesson-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        ex=SK['backrank']['exercises'][0]
        await solve_exercise(pg, ex)
        ok('Solved' in await msg(pg), 'back-rank 1 solved first try')
        await pg.click('[data-testid=puzzle-next]'); await pg.wait_for_timeout(300)
        await pg.get_by_role('button',name='Show solution').click(); await pg.wait_for_timeout(300)
        ok('does not count' in await msg(pg), 'showing the solution does not count as solved')
        await pg.click('[data-testid=puzzle-next]'); await pg.wait_for_timeout(200)
        await pg.get_by_role('button',name='Leave').click(); await pg.wait_for_selector('[data-testid=skill-detail]')
        ok(await pg.get_by_role('tab',name='Learn').get_attribute('aria-selected')=='true', 'Leave returns to the Learn tab')
        ok((await fen(pg))==game_fen, 'game restored again')
        # persistence
        await pg.reload(); await pg.wait_for_selector('cg-board'); await goto_tab(pg,'Learn'); await pg.wait_for_selector('[data-testid=learn-summary]')
        card=await pg.inner_text('[data-testid=skill-najdorf]'); ok('Mastered' not in card and '1/1 solved' in card, f'Najdorf progress persisted ({card.splitlines()[-1]})')
        await pg.screenshot(path='/tmp/claude-0/learn_list.png')
        # --- mobile
        m=await (await b.new_context(viewport={'width':390,'height':800})).new_page(); mlogs=[]
        m.on('pageerror',lambda e: mlogs.append(str(e)))
        await m.goto(URL); await m.wait_for_selector('cg-board'); await m.get_by_role('button',name='Learn',exact=True).click()
        await m.wait_for_selector('[data-testid=learn-summary]'); ok(await m.locator('.skill-card').count()==len(LES), 'mobile: Learn tab lists the skills')
        ow=await m.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"); ok(ow, 'mobile: no horizontal overflow')
        await m.screenshot(path='/tmp/claude-0/learn_mobile.png')
        ok(not logs and not mlogs, f'no console/page errors {logs[:3]} {mlogs[:3]}')
        await b.close()
    print('FAILED' if ok.bad else 'ALL PASSED'); raise SystemExit(1 if ok.bad else 0)
asyncio.run(main())
