import asyncio, json, random, os
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
PUZ=json.load(open(os.path.join(os.path.dirname(__file__),'..','public','data','puzzles.json')))

async def sq_xy(pg, sq):
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
    return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
async def play(pg, uci):
    x1,y1=await sq_xy(pg,uci[:2]); x2,y2=await sq_xy(pg,uci[2:4])
    await pg.mouse.click(x1,y1); await pg.wait_for_timeout(60); await pg.mouse.click(x2,y2); await pg.wait_for_timeout(120)
    if len(uci)==5 and await pg.locator('.promotion').count():
        await pg.get_by_label({'q':'Queen','r':'Rook','b':'Bishop','n':'Knight'}[uci[4]]).click()
    await pg.wait_for_timeout(200)
async def msg(pg): return (await pg.locator('[data-testid=puzzle-message]').inner_text()).strip()
async def cur_fen(pg): return await pg.evaluate("document.querySelector('.board-wrap').dataset.fen")

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); logs=[]
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # a real game to be parked
        for m in ['e2e4','e7e5','g1f3']: await play(pg,m)
        game_fen=await cur_fen(pg); n_moves=await pg.locator('.move-list .mv').count()
        await goto_tab(pg,'Puzzles')
        print('puzzles bundled:', len(PUZ), {d:sum(1 for x in PUZ if x['difficulty']==d) for d in ['easy','medium','hard']}, {t:sum(1 for x in PUZ if x['theme']==t) for t in sorted({x['theme'] for x in PUZ})})
        await pg.get_by_label('Puzzle type').select_option('tactic'); await pg.get_by_label('Puzzle difficulty').select_option('easy')
        await pg.click('[data-testid=puzzle-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        f=await cur_fen(pg); puz=next(x for x in PUZ if x['fen'].split()[0]==f.split()[0] and x['theme']=='tactic')
        print('started', puz['id'], puz['theme'], puz['difficulty'], '| msg:', await msg(pg))
        print('engine analysing?', await pg.inner_text('[data-testid=engine-status]'), '| eval bar visible:', await pg.locator('.eval-bar').is_visible())
        # wrong move: any legal move != solution[0]
        await pg.mouse.click(*await sq_xy(pg,'a1'))  # harmless click
        mover_white = puz['sideToMove']=='w'
        wrong=None
        for _ in range(60):
            d=await pg.evaluate("1"); 
            break
        # find some other legal move via UI: click each own piece, pick a dest not equal solution
        pieces=await pg.evaluate("""()=>[...document.querySelectorAll('cg-board piece')].map(p=>{const b=document.querySelector('cg-board').getBoundingClientRect();const r=p.getBoundingClientRect();return {c:[...p.classList].includes('white')?'w':'b',x:r.x+r.width/2,y:r.y+r.height/2}})""")
        sol0=puz['solution'][0]
        for pc in pieces:
            if pc['c']!=puz['sideToMove']: continue
            await pg.mouse.click(pc['x'],pc['y']); await pg.wait_for_timeout(50)
            dests=pg.locator('cg-board square.move-dest'); n=await dests.count()
            if n:
                # choose a destination that is not the solution target when this is the solution piece
                for k in range(n):
                    bb=await dests.nth(k).bounding_box(); tx,ty=bb['x']+bb['width']/2,bb['y']+bb['height']/2
                    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
                    sx,sy=await sq_xy(pg,sol0[2:4])
                    if abs(tx-sx)<s/2 and abs(ty-sy)<s/2: continue
                    await pg.mouse.click(tx,ty); wrong=True; break
            if wrong: break
        await pg.wait_for_timeout(300)
        print('after wrong move msg:', await msg(pg))
        await pg.wait_for_timeout(3500)
        print('after retry delay -> msg:', await msg(pg), '| board back to puzzle:', (await cur_fen(pg)).split()[0]==puz['fen'].split()[0])
        # hint
        await pg.screenshot(path='/tmp/claude-0/pre_hint.png'); print('hint btn:', await pg.get_by_role('button',name='Hint').evaluate('b=>[b.disabled,b.outerHTML]')); await pg.get_by_role('button',name='Hint').click(timeout=4000); await pg.wait_for_timeout(400); print('hint:', await msg(pg), '| squares highlighted:', await pg.evaluate("document.querySelectorAll('.cg-wrap svg circle, .cg-wrap svg ellipse').length"))
        # solve with the stored solution
        for i,m in enumerate(puz['solution']):
            if i%2==0:
                await play(pg,m)
            else:
                await pg.wait_for_timeout(900)   # engine reply plays itself
        await pg.wait_for_timeout(500)
        print('after solving:', await msg(pg), '| solution shown:', await pg.inner_text('[data-testid=puzzle-solution]'), '| streak', await pg.inner_text('[data-testid=puzzle-streak]'))
        # board locked after solve
        await pg.mouse.click(*await sq_xy(pg,'e1')); print('dests after solve:', await pg.locator('cg-board square.move-dest').count())
        # reload mid-puzzle restores the real game
        await pg.click('[data-testid=puzzle-next]'); await pg.wait_for_selector('[data-testid=puzzle-message]'); await pg.wait_for_timeout(700)
        await pg.reload(); await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(500)
        print('after reload mid-puzzle: game fen restored:', (await cur_fen(pg))==game_fen or (await cur_fen(pg)), '| moves', await pg.locator('.move-list .mv').count(), 'expected', n_moves)
        # progress persisted
        await goto_tab(pg,'Puzzles'); print('stats:', (await pg.locator('.puzzle-stats').inner_text()).replace('\n',' '))
        # reveal solution + exit restores
        await pg.click('[data-testid=puzzle-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        await pg.get_by_role('button',name='Show solution').click(); await pg.wait_for_timeout(300); print('revealed:', await msg(pg), '|', await pg.inner_text('[data-testid=puzzle-solution]'))
        await pg.get_by_role('button',name='Exit puzzles').click(); await pg.wait_for_timeout(600)
        print('after exit: fen ok', (await cur_fen(pg))==game_fen if False else await cur_fen(pg), '| moves', await pg.locator('.move-list .mv').count(), '| engine', await pg.inner_text('[data-testid=engine-status]'))
        # mate puzzle with alternative mate allowed: solve via stored move
        await goto_tab(pg,'Puzzles'); await pg.get_by_label('Puzzle type').select_option('mate1'); await pg.click('[data-testid=puzzle-start]'); await pg.wait_for_selector('[data-testid=puzzle-active]')
        f=await cur_fen(pg); mp=next(x for x in PUZ if x['fen'].split()[0]==f.split()[0]); await play(pg,mp['solution'][0]); print('mate1:', await msg(pg))
        # mobile
        m=await b.new_page(viewport={'width':390,'height':800}); await m.goto(URL); await m.wait_for_selector('cg-board'); await m.get_by_role('button',name='Puzzles',exact=True).last.click(); await m.click('[data-testid=puzzle-start]'); await m.wait_for_timeout(500)
        print('mobile: board visible', await m.locator('cg-board').is_visible(), 'hscroll', await m.evaluate('document.documentElement.scrollWidth>innerWidth'))
        await m.screenshot(path='/tmp/claude-0/puzzle_mobile.png'); await pg.screenshot(path='/tmp/claude-0/puzzle_desktop.png')
        print('LOGS',logs); await b.close()
asyncio.run(main())
