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

import asyncio
from playwright.async_api import async_playwright

URL='http://localhost:4173/'

async def load_fen(pg, fen):
    await pg.fill('input[aria-label=FEN]', fen)
    await pg.get_by_role('button', name='Load', exact=True).click()
    if await pg.get_by_role('button', name='Load position').count(): await pg.get_by_role('button', name='Load position').click()
    await pg.wait_for_timeout(300)
async def settle(pg, depth=12):
    await pg.wait_for_function(f"(()=>{{const t=document.querySelector('[data-testid=engine-depth]')?.textContent||'';return parseInt(t)>={depth}}})()", timeout=90000)
async def score(pg):
    return (await pg.inner_text('[data-testid=engine-score]'), await pg.get_attribute('[data-testid=eval-bar]','aria-valuenow'), await pg.get_attribute('[data-testid=eval-bar]','aria-valuetext'))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1440,'height':900})).new_page()
        logs=[]; pg.on('console',lambda m: logs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        await pg.goto(URL); await pg.wait_for_selector('cg-board'); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        tests=[('B mate in 1, B to move','r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1','mate-'),('illegal FEN (opp in check)','4k3/8/8/8/8/8/5PPP/r5K1 b - - 0 1','x')]
        for name,fen,exp in tests:
            await load_fen(pg,fen)
            if exp in('pos','neg','mate+','mate-'): await settle(pg,10)
            else: await pg.wait_for_timeout(500)
            sc=await score(pg); st=await pg.inner_text('[data-testid=game-status]')
            lines=await pg.locator('[data-testid=pv-line] .pv-score').all_inner_texts()
            print(f'{name:28} score={sc[0]:7} bar={sc[1]:>3}% "{sc[2]}" status="{st}" lines={lines}')
        print('sidebar error:', await pg.locator('.sidebar .callout.error').all_inner_texts())
        print('LOGS',logs); await b.close()
asyncio.run(main())