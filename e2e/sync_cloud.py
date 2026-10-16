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
            if 'profiles' not in state: state['profiles']={'username':'fabbed','created_at':'2026-01-01T00:00:00Z','avatar':None}
            prof=state['profiles']
            if req.method=='GET': return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps([prof] if prof else []))
            if req.method in ('POST','PATCH'):
                body=json.loads(req.post_data or '{}')
                if body.get('username','').lower()=='raced': return await route.fulfill(status=409, headers=CORS, content_type='application/json', body=json.dumps({'code':'23505','message':'duplicate key value'}))
                if req.method=='POST' or not prof: prof={'created_at':'2026-10-16T10:00:00Z','avatar':None}
                prof.update({k:v for k,v in body.items() if k!='user_id'}); state['profiles']=prof
                return await route.fulfill(status=201 if req.method=='POST' else 200, headers=CORS, content_type='application/json', body=json.dumps(prof))
            if req.method=='DELETE': return await route.fulfill(status=204, headers=CORS)
        if '/rest/v1/profile_stats' in u:
            if req.method in ('POST','PATCH'): state.setdefault('stats_posts',[]).append(json.loads(req.post_data or '{}')); return await route.fulfill(status=201, headers=CORS, content_type='application/json', body='[]')
            if req.method=='DELETE': return await route.fulfill(status=204, headers=CORS)
        if '/rest/v1/rpc/friends_overview' in u: return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps(state.get('friends',[])))
        if '/rest/v1/rpc/search_user' in u:
            nm=json.loads(req.post_data or '{}').get('p_name','').lower()
            hit=[x for x in state.get('users',[]) if x['username'].lower()==nm]
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps(hit))
        if '/rest/v1/rpc/friend_request' in u:
            t=json.loads(req.post_data or '{}').get('p_target'); u2=[x for x in state.get('users',[]) if x['user_id']==t][0]
            state.setdefault('friends',[]).append({'friendship_id':'f-'+t,'user_id':t,'username':u2['username'],'avatar':None,'status':'pending','incoming':False,'member_since':None,'stats':None})
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body='"pending"')
        if '/rest/v1/rpc/friend_respond' in u:
            d=json.loads(req.post_data or '{}')
            for f in state.get('friends',[]):
                if f['friendship_id']==d['p_id']:
                    if d['p_accept']: f.update({'status':'accepted','member_since':'2026-02-01T00:00:00Z','stats':{'level':{'low':1100,'high':1300},'games':12,'solved':40,'bestStreak':6}})
                    else: state['friends'].remove(f)
                    break
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body='"accepted"' if d['p_accept'] else '"declined"')
        if '/rest/v1/rpc/friend_remove' in u:
            d=json.loads(req.post_data or '{}'); state['friends']=[f for f in state.get('friends',[]) if f['friendship_id']!=d['p_id']]
            return await route.fulfill(status=200, headers=CORS, content_type='application/json', body='null')
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
        check('the form warns about the spam folder BEFORE sending', 'spam' in (await pg.inner_text('[data-testid=spam-hint]')).lower())
        await pg.fill('[data-testid=account-email]','fabian@example.com'); await pg.click('[data-testid=account-send]')
        await pg.wait_for_selector('[data-testid=account-link-sent]')
        otp=[r for r in st['reqs'] if '/auth/v1/otp' in r[1]]
        check('sign-in link request sent once with the address', len(otp)==1 and 'fabian@example.com' in (otp[0][3] or ''))
        check('the sign-in form warns that the e-mail probably ends up in spam', 'spam' in (await pg.inner_text('[data-testid=spam-note]')).lower())
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
        check('the profile dialog never shows the e-mail address', 'fabian@example.com' not in txt and 'f***' not in txt and 'fabian' not in (await pg.inner_text('[data-testid=account-open]')).lower())
        check('delete / sync / username are NOT in the profile dialog any more', 'Delete my cloud data' not in txt and not await pg.query_selector('[data-testid=account-sync]') and not await pg.query_selector('[data-testid=username-input]'))
        await pg.click('[data-testid=profile-settings]'); await pg.wait_for_selector('[data-testid=account-email-row]')
        stxt=await pg.inner_text('[data-testid=account]')
        check('settings: e-mail is masked by default, shown after Show', 'fabian@example.com' not in stxt and 'f***@example.com' in stxt)
        await pg.click('[data-testid=account-email-toggle]')
        check('settings: Show reveals the address', 'fabian@example.com' in await pg.inner_text('[data-testid=account-email-shown]'))
        check('settings hold picture, username, sync and delete', all([await pg.query_selector(x) is not None for x in ['[data-testid=avatar-input]','[data-testid=username-input]','[data-testid=account-sync]','[data-testid=account-delete]','[data-testid=account-signout]']]))
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
        await pg.click('[data-testid=open-settings]'); await pg.click('text=Delete my cloud data'); await pg.wait_for_selector('[data-testid=account-delete]')
        await pg.click('[data-testid=account-delete]'); await pg.get_by_role('button',name='Delete cloud data').last.click(); await pg.wait_for_timeout(800)
        dels=[r for r in st['reqs'] if r[0]=='DELETE']
        check('delete cloud data removes only this user\'s rows (synced data + shared numbers)', len(dels)==2 and all('user_id=eq.user-1' in d[1] for d in dels) and {('user_data' in d[1]) for d in dels}=={True,False})
        await pg.click('[data-testid=account-signout]'); await pg.wait_for_selector('[data-testid=settings-account]'); await pg.keyboard.press('Escape'); await pg.click('[data-testid=account-open]'); await pg.wait_for_selector('[data-testid=account-email]')
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
        await pg2.click('[data-testid=open-settings]'); await pg2.fill('[data-testid=username-input]','Raced'); await pg2.wait_for_timeout(900)
        await pg2.click('[data-testid=username-save]'); await pg2.wait_for_selector('[data-testid=username-error]')
        check('a name taken between the check and the save is reported, profile unchanged', 'just taken' in await pg2.inner_text('[data-testid=username-error]') and 'Knight_Rider' in await pg2.inner_text('[data-testid=account-open]'))
        check('no page errors in the profile flow', not errs2)
        await ctx2.close()
        # friends, picture, shared numbers
        st3={'reqs':[],'rows':[],'users':[{'user_id':'u-alice','username':'Alice','avatar':None}],
             'friends':[{'friendship_id':'f-bob','user_id':'u-bob','username':'Bob','avatar':None,'status':'pending','incoming':True,'member_since':None,'stats':None}]}
        ctx3=await b.new_context(viewport={'width':1440,'height':900}); await mock(ctx3,st3)
        games3=json.dumps([{'id':'imp-9','source':'import','endedAt':1700000000,'userColor':'w','label':'x','moves':30,'acpl':50,'accuracy':80,'counts':{'inaccuracy':1,'mistake':0,'blunder':0},'catCount':{},'catLoss':{},'myRating':None,'depth':12,'mistakes':[]}])
        await ctx3.add_init_script("if(!localStorage.getItem('sb-testproj-auth-token')) { localStorage.setItem('sb-testproj-auth-token', %s); localStorage.setItem('chess-analysis:strength-games:v1', %s); }" % (json.dumps(session()), json.dumps(games3)))
        pg3=await ctx3.new_page(); errs3=[]; pg3.on('pageerror',lambda e: errs3.append(str(e)))
        await pg3.goto(SURL); await pg3.wait_for_selector('[data-testid=account-open]'); await pg3.wait_for_timeout(1500)
        check('the side button shows the username and a badge for the open friend request', 'fabbed' in await pg3.inner_text('[data-testid=account-open]') and '1' in await pg3.inner_text('.badge-count'))
        await pg3.click('[data-testid=account-open]'); await pg3.wait_for_selector('[data-testid=friend-requests]')
        check('incoming request from Bob is listed', 'Bob' in await pg3.inner_text('[data-testid=friend-requests]'))
        await pg3.click('[data-testid=friend-accept]'); await pg3.wait_for_selector('[data-testid=friend-item]')
        check('after accepting, Bob is in the friend list with his level', 'Bob' in await pg3.inner_text('[data-testid=friend-item]') and '1100' in await pg3.inner_text('[data-testid=friend-item]'))
        await pg3.click('[data-testid=friend-item]'); await pg3.wait_for_selector('[data-testid=friend-profile]')
        ftxt=await pg3.inner_text('[data-testid=friend-profile]')
        check('friend profile shows name, since-date and the shared numbers', 'Bob' in ftxt and '1100–1300' in ftxt and '40' in ftxt and 'Member since' in ftxt)
        check('viewing a friend replaces my own profile header (no mix-up)', not await pg3.query_selector('[data-testid=profile-name]'))
        await pg3.screenshot(path='/tmp/claude-0/friend_profile.png')
        await pg3.click('[data-testid=friend-back]'); await pg3.wait_for_selector('[data-testid=friends]')
        await pg3.fill('[data-testid=friend-search]','nobody'); await pg3.click('[data-testid=friend-find]'); await pg3.wait_for_selector('[data-testid=friend-msg]')
        check('unknown username gives a clear message', 'Nobody is called' in await pg3.inner_text('[data-testid=friend-msg]'))
        await pg3.fill('[data-testid=friend-search]','alice'); await pg3.click('[data-testid=friend-find]'); await pg3.wait_for_selector('[data-testid=friend-found]')
        await pg3.click('[data-testid=friend-add]'); await pg3.wait_for_selector('[data-testid=friend-sent]')
        reqf=[r for r in st3['reqs'] if 'rpc/friend_request' in r[1]]
        check('friend request sent for the right user id', len(reqf)==1 and json.loads(reqf[0][3])=={'p_target':'u-alice'})
        await pg3.screenshot(path='/tmp/claude-0/friends_list.png')
        await pg3.click('[data-testid=friend-cancel]'); await pg3.wait_for_timeout(500)
        check('a sent request can be cancelled', not await pg3.query_selector('[data-testid=friend-sent]'))
        await pg3.click('[data-testid=friend-item]'); await pg3.click('[data-testid=friend-remove]'); await pg3.get_by_role('button',name='Remove friend').last.click(); await pg3.wait_for_selector('[data-testid=no-friends]')
        check('a friend can be removed', True)
        # numbers shared with friends: only plain numbers, own user id
        for _ in range(20):
            if st3.get('stats_posts'): break
            await pg3.wait_for_timeout(500)
        sp=(st3.get('stats_posts') or [None])[-1]
        check('shared numbers are only level / games / puzzles / streak', sp is not None and sp['user_id']=='user-1' and set(sp['stats'])=={'level','games','solved','bestStreak'} and sp['stats']['games']==1)
        # picture upload in Settings
        await pg3.keyboard.press('Escape'); await pg3.click('[data-testid=open-settings]'); await pg3.wait_for_selector('[data-testid=avatar-input]', state='attached')
        await pg3.set_input_files('[data-testid=avatar-input]','/tmp/claude-0/pic.svg'); await pg3.wait_for_selector('[data-testid=avatar-error]')
        check('an SVG is refused as profile picture', 'PNG, JPEG or WebP' in await pg3.inner_text('[data-testid=avatar-error]'))
        await pg3.set_input_files('[data-testid=avatar-input]','/tmp/claude-0/pic.png'); await pg3.wait_for_selector('[data-testid=avatar-remove]')
        pa=[r for r in st3['reqs'] if r[0]=='PATCH' and '/rest/v1/profiles' in r[1] and 'avatar' in (r[3] or '')]
        av=json.loads(pa[-1][3])['avatar'] if pa else ''
        check('uploaded picture is stored as a small square JPEG data URL', av.startswith('data:image/jpeg;base64,') and len(av)<=60000)
        dims=await pg3.evaluate("(async()=>{const i=new Image();i.src=%s;await i.decode();return [i.naturalWidth,i.naturalHeight]})()" % json.dumps(av))
        check('the stored picture is exactly 128x128', dims==[128,128])
        check('the picture shows in the account button', await pg3.is_visible('[data-testid=account-open] img.avatar'))
        await pg3.screenshot(path='/tmp/claude-0/settings_account.png')
        await pg3.click('[data-testid=avatar-remove]'); await pg3.wait_for_timeout(500)
        check('the picture can be removed', not await pg3.query_selector('[data-testid=account-open] img.avatar'))
        # privacy switch removes the shared numbers
        await pg3.uncheck('[data-testid=share-stats]'); await pg3.wait_for_timeout(800)
        dl=[r for r in st3['reqs'] if r[0]=='DELETE' and 'profile_stats' in r[1]]
        check('turning sharing off deletes the shared numbers and is remembered', len(dl)==1 and 'user_id=eq.user-1' in dl[0][1] and await pg3.evaluate("localStorage.getItem('chess-analysis-sync:share-stats:v1')")=='0')
        check('no page errors in friends / picture flow', not errs3)
        if errs3: print(errs3[:3])
        await ctx3.close()
        await b.close()
    raise SystemExit(0 if ok else 1)
asyncio.run(main())
