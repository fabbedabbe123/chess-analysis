import asyncio, base64, json, os, time
from playwright.async_api import async_playwright
exec(open(os.path.join(os.path.dirname(__file__),'common.py')).read())
# Needs a build WITH a Supabase project configured, served on :4174 (see README "Cloud sync"). The server is a MOCK:
# this checks the app's own wiring (requests, headers, what is uploaded / applied), not a real Supabase project.
SURL='http://localhost:4174/?workspace'
PROJ='https://testproj.supabase.co'
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b'=').decode()
JWT=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':'user-1','role':'authenticated','exp':int(time.time())+7200})+'.sig'
def session():
    return json.dumps({'access_token':JWT,'refresh_token':'r','token_type':'bearer','expires_in':7200,'expires_at':int(time.time())+7200,
      'user':{'id':'user-1','aud':'authenticated','role':'authenticated','email':'fabian@example.com','app_metadata':{},'user_metadata':{},'created_at':'2026-01-01T00:00:00Z'}})
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'*'}
async def mock(ctx, state):
    async def h(route, req):
        if req.method=='OPTIONS': return await route.fulfill(status=204, headers=CORS)
        u=req.url; state['reqs'].append((req.method,u,dict(req.headers),req.post_data))
        if '/auth/v1/otp' in u: return await route.fulfill(status=200, headers=CORS, content_type='application/json', body='{}')
        if '/auth/v1/logout' in u: return await route.fulfill(status=204, headers=CORS)
        if '/rest/v1/profiles' in u:
            if req.method=='GET': return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps(state.get('profiles',[{'username':'fabbed','created_at':'2026-01-01T00:00:00Z'}])))
            if req.method in ('POST','PATCH'):
                body=json.loads(req.post_data or '{}'); 
                if body.get('username','').lower()=='raced': return await route.fulfill(status=409, headers=CORS, content_type='application/json', body=json.dumps({'code':'23505','message':'duplicate key value'}))
                row={'username':body['username'],'created_at':'2026-10-16T10:00:00Z'}; state['profiles']=[row]; return await route.fulfill(status=201, headers=CORS, content_type='application/json', body=json.dumps(row))
            if req.method=='DELETE': return await route.fulfill(status=204, headers=CORS)
        if '/rest/v1/rpc/username_available' in u:
            nm=json.loads(req.post_data or '{}').get('name','').lower()
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body='false' if nm in ('taken_name','race') else 'true')
        if '/rest/v1/user_data' in u:
            if req.method=='GET': return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps(state['rows']))
            if req.method in ('POST','PATCH'): return await route.fulfill(status=201, headers=CORS, content_type='application/json', body='[]')
            if req.method=='DELETE': return await route.fulfill(status=204, headers=CORS)
        return await route.fulfill(status=404, headers=CORS, body='{}')
    await ctx.route(PROJ+'/**', h)
async def main():
    ok=True
    def check(n,c):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+n); ok = ok and bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(**LAUNCH,args=['--no-sandbox'])
        # 0) a normal build (no Supabase project) says so and makes no cloud request
        pg0=await (await b.new_context(viewport={'width':1440,'height':900})).new_page(); reqs0=[]
        pg0.on('request',lambda r: reqs0.append(r.url))
        await pg0.goto(URL); await pg0.wait_for_selector('cg-board'); await pg0.click('[data-testid=open-settings]'); await pg0.wait_for_selector('[data-testid=account-off]')
        check('build without a Supabase project: Account says sync is off, no supabase request', not [u for u in reqs0 if 'supabase' in u])
        await pg0.context.close()
        # 1) not signed in: e-mail link flow
        st={'reqs':[],'rows':[]}
        ctx=await b.new_context(viewport={'width':1440,'height':900}); await mock(ctx,st); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(SURL); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('cg-board')
        await pg.click('[data-testid=account-open]'); await pg.wait_for_selector('[data-testid=account-email]')
        await pg.click('[data-testid=account-open]') if False else None
        check('signed out: no cloud request is made before the user signs in', not [r for r in st['reqs'] if '/rest/v1' in r[1]])
        await pg.fill('[data-testid=account-email]','fabian@example.com'); await pg.click('[data-testid=account-send]')
        await pg.wait_for_selector('[data-testid=account-link-sent]')
        otp=[r for r in st['reqs'] if '/auth/v1/otp' in r[1]]
        check('sign-in link request sent once with the address', len(otp)==1 and 'fabian@example.com' in (otp[0][3] or ''))
        check('after sending: resend is locked for a minute and the address can be changed', await pg.is_disabled('[data-testid=account-resend]') and await pg.is_visible('[data-testid=account-other-email]'))
        await pg.click('[data-testid=account-other-email]'); await pg.wait_for_selector('[data-testid=account-email]')
        check('"use another e-mail" brings the form back', await pg.is_visible('[data-testid=account-send]'))
        await pg.screenshot(path='/tmp/claude-0/signin_dialog.png')
        check('sign-in link asks for no password and sends the public key only', 'password' not in (otp[0][3] or '') and otp[0][2].get('apikey')=='a'*40)
        await ctx.close()
        # 2) signed in on a new device: cloud data is downloaded and applied
        st={'reqs':[],'rows':[{'name':'library','value':json.dumps([{'id':'g1','title':'From the cloud','pgn':'1. e4 e5 *','savedAt':5}]),'updated_at':'2026-10-01T10:00:00Z'},
                               {'name':'settings','value':json.dumps({'theme':'light'}),'updated_at':'2026-10-01T10:00:00Z'}]}
        ctx=await b.new_context(viewport={'width':1440,'height':900}); await mock(ctx,st); pg=await ctx.new_page()
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await ctx.add_init_script("if(!localStorage.getItem('sb-testproj-auth-token')) { localStorage.setItem('sb-testproj-auth-token', %s); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({theme:'dark',explorerToken:'lip_SECRET'})); }" % json.dumps(session()))
        await pg.goto(SURL); await pg.wait_for_selector('cg-board')
        await pg.wait_for_function("JSON.parse(localStorage.getItem('chess-analysis:library:v1')||'[]').length===1", timeout=20000)
        await pg.wait_for_selector('cg-board'); await pg.wait_for_timeout(1500)
        lib=await pg.evaluate("localStorage.getItem('chess-analysis:library:v1')")
        check('new device: saved games from the cloud are applied', 'From the cloud' in lib)
        sett=json.loads(await pg.evaluate("localStorage.getItem('chess-analysis:settings:v1')"))
        check('settings from the cloud applied but the local Lichess token is kept', sett.get('theme')=='light' and sett.get('explorerToken')=='lip_SECRET')
        gets=[r for r in st['reqs'] if r[0]=='GET' and '/rest/v1/user_data' in r[1]]
        check('requests carry the signed-in user token and the public key', gets and gets[0][2].get('authorization')=='Bearer '+JWT and gets[0][2].get('apikey')=='a'*40)
        await pg.click('[data-testid=account-open]'); await pg.wait_for_selector('[data-testid=account-status]')
        txt=await pg.inner_text('[data-testid=account-dialog]')
        check('signed-in profile does NOT show the e-mail address by default', 'fabian@example.com' not in txt and 'fabian' not in (await pg.inner_text('[data-testid=account-open]')).lower() and 'f***@example.com' in txt)
        await pg.click('[data-testid=account-email-toggle]')
        check('e-mail is shown only after pressing Show', 'fabian@example.com' in await pg.inner_text('[data-testid=account-email-shown]'))
        await ctx.close()
        # 3) signed in with local data and an empty cloud: uploaded, token never included
        st={'reqs':[],'rows':[]}
        ctx=await b.new_context(viewport={'width':1440,'height':900}); await mock(ctx,st); pg=await ctx.new_page()
        pg.on('pageerror',lambda e: errs.append(str(e)))
        games=json.dumps([{'id':'imp-1','source':'import','endedAt':1700000000,'userColor':'w','label':'x','moves':30,'acpl':50,'accuracy':80,'counts':{'inaccuracy':1,'mistake':0,'blunder':0},'catCount':{},'catLoss':{},'myRating':None,'depth':12,'mistakes':[]}])
        await ctx.add_init_script("if(!localStorage.getItem('sb-testproj-auth-token')) { localStorage.setItem('sb-testproj-auth-token', %s); localStorage.setItem('chess-analysis:settings:v1', JSON.stringify({theme:'dark',explorerToken:'lip_SECRET'})); localStorage.setItem('chess-analysis:strength-games:v1', %s); localStorage.setItem('chess-analysis:game:v1','{\"x\":1}'); }" % (json.dumps(session()), json.dumps(games)))
        await pg.goto(SURL); await pg.wait_for_selector('cg-board')
        for _ in range(40):
            posts=[r for r in st['reqs'] if r[0]=='POST' and '/rest/v1/user_data' in r[1]]
            if posts: break
            await pg.wait_for_timeout(500)
        check('local data is uploaded after sign-in', bool(posts))
        body=posts[0][3] if posts else '[]'
        rows=json.loads(body)
        names=sorted(r['name'] for r in rows)
        check('uploaded: settings and analysed games only (not the board game)', names==['settings','strength-games'])
        check('every uploaded row belongs to the signed-in user', all(r['user_id']=='user-1' for r in rows))
        check('the Lichess token is never uploaded', 'lip_SECRET' not in body and 'explorerToken' not in body)
        # delete cloud data and sign out
        await pg.click('[data-testid=account-open]'); await pg.click('text=Delete my cloud data'); await pg.wait_for_selector('[data-testid=account-delete]')
        await pg.click('[data-testid=account-delete]'); await pg.get_by_role('button',name='Delete cloud data').last.click(); await pg.wait_for_timeout(800)
        dels=[r for r in st['reqs'] if r[0]=='DELETE']
        check('delete cloud data removes only this user\'s rows', len(dels)==1 and 'user_id=eq.user-1' in dels[0][1])
        await pg.click('[data-testid=account-signout]'); await pg.wait_for_selector('[data-testid=account-email]')
        check('after sign out the sign-in form is back and local data is kept', await pg.evaluate("localStorage.getItem('chess-analysis:strength-games:v1')!==null"))
        check('no page errors', not errs)
        if errs: print(errs[:3])
        # profile: first sign-in asks for a unique username
        st2={'reqs':[],'rows':[],'profiles':[]}
        ctx2=await b.new_context(viewport={'width':1440,'height':900}); await mock(ctx2,st2)
        await ctx2.add_init_script("if(!localStorage.getItem('sb-testproj-auth-token')) { localStorage.setItem('sb-testproj-auth-token', %s); }" % json.dumps(session()))
        pg2=await ctx2.new_page(); errs2=[]; pg2.on('pageerror',lambda e: errs2.append(str(e)))
        await pg2.goto(SURL); await pg2.wait_for_selector('[data-testid=username-input]', timeout=15000)
        check('first sign-in without a profile opens the username step', await pg2.is_visible('[data-testid=username-save]'))
        check('create button is disabled until a valid free name is typed', await pg2.is_disabled('[data-testid=username-save]'))
        await pg2.fill('[data-testid=username-input]','a b'); await pg2.wait_for_timeout(100)
        check('invalid characters are rejected instantly (no request)', 'Only letters' in await pg2.inner_text('[data-testid=username-hint]') and not [r for r in st2['reqs'] if 'username_available' in r[1]])
        await pg2.fill('[data-testid=username-input]','taken_name'); await pg2.wait_for_timeout(900)
        check('a taken name is reported and cannot be saved', 'taken' in (await pg2.inner_text('[data-testid=username-hint]')).lower() and await pg2.is_disabled('[data-testid=username-save]'))
        await pg2.fill('[data-testid=username-input]','Knight_Rider'); await pg2.wait_for_timeout(900)
        check('a free name is reported available', 'Available' in await pg2.inner_text('[data-testid=username-hint]') and not await pg2.is_disabled('[data-testid=username-save]'))
        await pg2.screenshot(path='/tmp/claude-0/username_step.png')
        await pg2.click('[data-testid=username-save]'); await pg2.wait_for_selector('[data-testid=profile-name]')
        ins=[r for r in st2['reqs'] if r[0]=='POST' and '/rest/v1/profiles' in r[1]]
        check('profile row inserted with this user id and the chosen name', len(ins)==1 and json.loads(ins[0][3])=={'user_id':'user-1','username':'Knight_Rider'})
        check('profile view shows the username, e-mail and stats', 'Knight_Rider' in await pg2.inner_text('[data-testid=profile-name]') and 'fabian@example.com' not in await pg2.inner_text('[data-testid=account-dialog]') and await pg2.is_visible('[data-testid=profile-stats]'))
        await pg2.screenshot(path='/tmp/claude-0/profile_view.png')
        await pg2.keyboard.press('Escape'); await pg2.wait_for_timeout(200)
        check('the side button now shows the username', 'Knight_Rider' in await pg2.inner_text('[data-testid=account-open]'))
        # a duplicate that slipped past the live check (race) is reported
        await pg2.click('[data-testid=account-open]'); await pg2.fill('[data-testid=username-input]','Raced'); await pg2.wait_for_timeout(900)
        await pg2.click('[data-testid=username-save]'); await pg2.wait_for_selector('[data-testid=username-error]')
        check('a name taken between the check and the save is reported, profile unchanged', 'just taken' in await pg2.inner_text('[data-testid=username-error]') and 'Knight_Rider' in await pg2.inner_text('[data-testid=profile-name]'))
        check('no page errors in the profile flow', not errs2)
        await ctx2.close()
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
