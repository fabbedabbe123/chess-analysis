import asyncio, random, re
from playwright.async_api import async_playwright
URL='http://localhost:4173/'
BOARD_JS = """() => {
  const wrap=document.querySelector('.board-wrap'); const b=document.querySelector('cg-board').getBoundingClientRect(); const s=b.width/8;
  const flipped = document.querySelector('.cg-wrap').classList.contains('orientation-black');
  const out={};
  document.querySelectorAll('cg-board piece').forEach(p=>{ if(p.classList.contains('ghost')||p.classList.contains('dragging')) return;
    const r=p.getBoundingClientRect(); let f=Math.floor((r.x+r.width/2-b.x)/s), rk=Math.floor((r.y+r.height/2-b.y)/s);
    if(flipped){f=7-f; rk=7-rk;} const sq='abcdefgh'[f]+(8-rk);
    const cls=[...p.classList]; const color=cls.includes('white')?'w':'b'; const role={pawn:'p',knight:'n',bishop:'b',rook:'r',queen:'q',king:'k'}[cls.find(c=>['pawn','knight','bishop','rook','queen','king'].includes(c))];
    out[sq]= color==='w'? role.toUpperCase():role; });
  return {fen: wrap.dataset.fen, pieces: out, node: wrap.dataset.node};
}"""
def fen_pieces(fen):
    out={}
    for r,row in enumerate(fen.split()[0].split('/')):
        f=0
        for ch in row:
            if ch.isdigit(): f+=int(ch)
            else: out['abcdefgh'[f]+str(8-r)]=ch; f+=1
    return out
async def board_ok(pg, label, errs):
    await pg.wait_for_timeout(350)
    d=await pg.evaluate(BOARD_JS)
    if fen_pieces(d['fen'])!=d['pieces']: errs.append(f'BOARD/FEN MISMATCH after {label}: {d["fen"]} vs {d["pieces"]}')
    sel=await pg.locator('.mv.selected').count()
    if sel:
        n=await pg.locator('.mv.selected').get_attribute('data-node')
        if n!=d['node']: errs.append(f'MOVELIST/BOARD node mismatch after {label}: {n} vs {d["node"]}')
    elif d['fen'].split()[0]!='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' and not label.startswith('load'):
        pass
async def rand_move(pg):
    d=await pg.evaluate(BOARD_JS); turn=d['fen'].split()[1]
    box=await pg.locator('cg-board').bounding_box(); s=box['width']/8
    flipped=await pg.evaluate("document.querySelector('.cg-wrap').classList.contains('orientation-black')")
    def c(sq):
        f='abcdefgh'.index(sq[0]); r=int(sq[1])-1
        return (box['x']+((7-f if flipped else f)+.5)*s, box['y']+((r if flipped else 7-r)+.5)*s)
    mine=[sq for sq,p in d['pieces'].items() if (p.isupper())==(turn=='w')]
    random.shuffle(mine)
    for sq in mine:
        x,y=c(sq); await pg.mouse.click(x,y); await pg.wait_for_timeout(60)
        n=await pg.locator('cg-board square.move-dest').count()
        if n:
            k=random.randrange(n); dest=pg.locator('cg-board square.move-dest').nth(k)
            bb=await dest.bounding_box(); await pg.mouse.click(bb['x']+bb['width']/2, bb['y']+bb['height']/2)
            await pg.wait_for_timeout(100)
            if await pg.locator('.promotion').count(): await pg.get_by_label(random.choice(['Queen','Knight','Rook','Bishop'])).click()
            return True
    return False
async def main():
    import sys; random.seed(int(sys.argv[1]))
    errs=[]; logs=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900},accept_downloads=True)).new_page()
        pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None)
        pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board')
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        # --- random walk sync test
        ops=0
        for i in range(220):
            r=random.random()
            if r<0.55:
                ok=await rand_move(pg); lab='move'
                if not ok: lab='nomove'
            elif r<0.7: await pg.keyboard.press('ArrowLeft'); lab='left'
            elif r<0.78: await pg.keyboard.press('ArrowRight'); lab='right'
            elif r<0.86: await pg.keyboard.press('Control+z'); lab='undo'
            elif r<0.92: await pg.keyboard.press('Control+Shift+z'); lab='redo'
            elif r<0.95: await pg.keyboard.press('Home'); lab='home'
            elif r<0.98: await pg.keyboard.press('End'); lab='end'
            else: await pg.keyboard.press('f'); lab='flip'
            await board_ok(pg,f'{i}:{lab}',errs); ops+=1
            if len(errs)>5: break
        print('random-walk ops',ops,'plies in list',await pg.locator('.move-list .mv').count(),'variations',await pg.locator('.variation').count())
        print('SYNC ERRORS:',errs[:5])
        print('console errors:',logs[:5])
        await b.close()
asyncio.run(main())
