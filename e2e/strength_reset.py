import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
def ag(i,src): return {'id':f'{src}-{i}','source':src,'endedAt':1700000000+i,'userColor':'w','label':f'g{i}','moves':30,'acpl':40,'accuracy':80,'counts':{},'catCount':{},'catLoss':{},'myRating':1200,'depth':10,'mistakes':[]}
def tg(i): return {'url':f'https://example.test/{i}','endTime':1700000000+i,'timeClass':'blitz','color':'w','outcome':'win','reason':'x','opponent':'o','rating':1200,'opponentRating':1200,'eco':None,'opening':None,'pgn':'1. e4 e5 *'}
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board')
        games=[ag(i,'chesscom') for i in range(3)]+[ag(i,'lichess') for i in range(2)]+[ag(9,'play')]
        await pg.evaluate("""([g,c,l])=>{localStorage.setItem('chess-analysis:strength-games:v1',g);localStorage.setItem('chess-analysis:tracker:v1',c);localStorage.setItem('chess-analysis:lichess:v1',l)}""",
          [json.dumps(games), json.dumps({'username':'olduser','games':[tg(1)],'fetchedMonths':[],'allArchives':[],'lastSync':1}), json.dumps({'username':'lichuser','games':[tg(2)],'cursor':None,'exhausted':True,'lastSync':1})])
        await pg.reload(); await pg.wait_for_selector('cg-board'); await goto_tab(pg,'Strength')
        check('reset card visible without opening anything', await pg.locator('[data-testid=reset-chesscom]').is_visible())
        await pg.click('[data-testid=reset-chesscom]'); await pg.get_by_role('button',name='Remove',exact=True).last.click(); await pg.wait_for_timeout(300)
        saved=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')"))
        check('only Chess.com games removed', sorted({g['source'] for g in saved})==['lichess','play'] and len(saved)==3)
        tr=await pg.evaluate("localStorage.getItem('chess-analysis:tracker:v1')")
        check('Chess.com account no longer tracked', tr is None or json.loads(tr).get('username') in (None,''))
        check('Chess.com row gone, Lichess row stays', await pg.locator('[data-testid=reset-chesscom]').count()==0 and await pg.locator('[data-testid=reset-lichess]').count()==1)
        li=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:lichess:v1')"))
        check('Lichess tracking untouched', li.get('username')=='lichuser')
        await pg.click('[data-testid=reset-all]'); await pg.get_by_role('button',name='Remove all').last.click(); await pg.wait_for_timeout(300)
        saved=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')"))
        check('remove all empties everything', saved==[])
        check('no page errors', not errs)
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
