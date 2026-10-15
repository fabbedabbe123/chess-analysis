import asyncio, os, json
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        pg=await (await b.new_context(viewport={'width':1280,'height':800},accept_downloads=True)).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.wait_for_selector('cg-board')
        game={'id':'g1','source':'play','endedAt':1700000000000,'userColor':'w','label':'vs test','moves':30,'acpl':60,'accuracy':80,'counts':{'inaccuracy':1,'mistake':1,'blunder':0},'catCount':{},'catLoss':{},'myRating':None,'depth':14}
        await pg.evaluate("g=>{localStorage.clear();localStorage.setItem('chess-analysis:strength-games:v1',JSON.stringify([g]));localStorage.setItem('chess-analysis:settings:v1',JSON.stringify({theme:'light',explorerToken:'lip_secret_token'}));localStorage.setItem('other:key','x')}",game); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.get_by_role('button',name='Settings').click(); await pg.wait_for_selector('[data-testid=backup-export]')
        async with pg.expect_download() as dl: await pg.click('[data-testid=backup-export]')
        d=await dl.value; path=await d.path(); text=open(path).read(); backup=json.loads(text)
        check('backup file has the app marker and our keys', backup['app']=='chess-analysis' and 'chess-analysis:strength-games:v1' in backup['data'])
        check('backup excludes other apps keys', not any(k.startswith('other') for k in backup['data']))
        check('Lichess token is not in the file', 'lip_secret_token' not in text)
        # wipe and restore
        await pg.evaluate("localStorage.clear()")
        await pg.click('[data-testid=backup-export]', no_wait_after=True) if False else None
        tmp='/tmp/claude-0/backup_test.json'; open(tmp,'w').write(text)
        await pg.set_input_files('[data-testid=backup-import]', tmp)
        await pg.get_by_role('button',name='Restore',exact=True).click()
        await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(500)
        stored=await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')")
        check('data is back after restore', stored is not None and json.loads(stored)[0]['id']=='g1')
        check('theme from the backup applied', await pg.evaluate("document.documentElement.dataset.theme")=='light')
        # garbage file is refused and changes nothing
        open(tmp,'w').write('{"app":"x"}')
        await pg.get_by_role('button',name='Settings').click(); await pg.wait_for_selector('[data-testid=backup-import]', state='attached')
        await pg.set_input_files('[data-testid=backup-import]', tmp); await pg.wait_for_timeout(400)
        check('invalid backup shows an error and keeps data', 'not a Chess Analysis backup' in await pg.inner_text('body') and await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')") is not None)
        check('no page errors', not errs)
        if errs: print(errs[:5])
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
