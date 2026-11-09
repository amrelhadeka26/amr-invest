import json, urllib.request
# The calculator's default inflation is the live figure; read the same one.
LIVE_INFL=json.load(urllib.request.urlopen(urllib.request.Request('https://grow-data.amrelhadeka.workers.dev/site.json', headers={'User-Agent': 'zd-qa'})))['inflation']['value']
exec(open('qa/indep.py').read())
d=json.load(open('qa/calc_out.json'))['res']
P={'balanced':dict(cd1=17.75,cd2=14,egx=15,us=9,gold=5,fx=7,re=12,rent=5),'past':dict(cd1=17.75,cd2=15,egx=15.5,us=14.8,gold=7.6,fx=16.7,re=12.2,rent=5),'cautious':dict(cd1=17.75,cd2=12,egx=12,us=7,gold=3,fx=4,re=9,rent=4.5)}
C=dict(cd=(0,0,0),egx=(0.25,0.25,0.3),us=(1,0.5,0.4),gold=(3,1,0),re=(3,2.5,0.5),cash=(0,0,0))
NAME={'Bank certificate':'cd','EGX30 stocks':'egx','Gold':'gold','Property':'re','US stocks':'us','Cash at home':'cash','Dollars at home':'cash'}
checked=0;fails=[];maxdiff=0
for x in d:
    s=x['s']; v=x['out']
    if s['name'] in ('negative start','infl -100','all zero','text input','huge'): continue
    p=dict(P[s.get('preset','balanced')]); base=dict(start=100000,monthly=3000,years=5,infl=LIVE_INFL,raise_=0)
    costs={k:list(c) for k,c in C.items()}
    for k,val in s['v'].items():
        if k in p: p[k]=float(val)
        elif k=='raise': base['raise_']=float(val)
        elif k in ('start','monthly','years','infl'): base[k]=float(val)
        elif k.startswith('c_'):
            _,o,t=k.split('_'); costs[o]['bsy'.index(t)]=float(val)
    if s.get('cur')=='USD': continue
    yrs=max(1,min(25,round(base['years'])))
    infl=base['infl']; deflate=(1+infl/100)**yrs
    usd=lambda r:((1+r/100)*(1+p['fx']/100)-1)*100
    rate={'cd':None,'egx':p['egx'],'us':usd(p['us']),'gold':usd(p['gold']),'re':((1+p['re']/100)*(1+p['rent']/100)-1)*100,'cash':0}
    keep=fv(base['start'],base['monthly'],yrs,infl,raise_=base['raise_'])
    for row in v['rows']:
        k=NAME[row[0]]; b,sl,yl=costs[k]
        f=fv(base['start'],base['monthly'],yrs,rate[k] or 0,b,sl,yl,base['raise_'],rate_fn=(lambda m:p['cd1'] if m<=36 else p['cd2']) if k=='cd' else None)
        shown=num(row[2]); real=num(row[3]); beyond=num(row[4])
        for lab,exp,got in (('value',f,shown),('real',f/deflate,real),('beyond',(f-keep)/deflate,beyond)):
            checked+=1; diff=abs(exp-got); maxdiff=max(maxdiff,diff)
            if diff>1.01: fails.append((s['name'],row[0],lab,round(exp),got))
    checked+=1
    if abs(keep-num(v['calc'].replace(' EGP','')))>1.01: fails.append((s['name'],'keepup',round(keep),v['calc']))
# closed-form check for zero-cost, no-raise scenario
x=[r for r in d if r['s']['name']=='zero costs 10y'][0]
for row in x['out']['rows']:
    k=NAME[row[0]]
    if k in ('egx','us','gold','re','cash'):
        p=P['balanced']; rr={'egx':p['egx'],'us':((1.09)*(1.07)-1)*100,'gold':((1.05)*(1.07)-1)*100,'re':((1.12)*(1.05)-1)*100,'cash':0}[k]
        exp=closed(100000,3000,10,rr); checked+=1
        if abs(exp-num(row[2]))>1.01: fails.append(('closed-form',row[0],round(exp),row[2]))
print('checks',checked,'fails',len(fails),'max abs diff EGP',round(maxdiff,2))
for f in fails[:20]: print(f)
