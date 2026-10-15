import asyncio, random, re
from playwright.async_api import async_playwright
URL='http://localhost:4173/'

# Browser launch settings: PW_CHROMIUM overrides the binary; otherwise the sandbox's Chromium if present, otherwise Playwright's own.
import os as _os
LAUNCH = {'executable_path': _os.environ['PW_CHROMIUM']} if _os.environ.get('PW_CHROMIUM') else ({'executable_path': '/opt/pw-browsers/chromium'} if _os.path.exists('/opt/pw-browsers/chromium') else {})
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
