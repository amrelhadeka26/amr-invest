import json,subprocess,os
exec(open('qa/indep.py').read())
ZERO={k:0 for k in ['c_cd_b','c_cd_s','c_cd_y','c_egx_b','c_egx_s','c_egx_y','c_us_b','c_us_s','c_us_y','c_gold_b','c_gold_s','c_gold_y','c_re_b','c_re_s','c_re_y']}
scen=[
 {'name':'default balanced','v':{}},
 {'name':'zero costs 10y','v':dict(ZERO,years=10)},
 {'name':'zero costs, raise 10%','v':dict(ZERO,**{'raise':10},years=7)},
 {'name':'start only','v':dict(monthly=0,start=250000,years=3)},
 {'name':'monthly only','v':dict(start=0,monthly=5000,years=4)},
 {'name':'1 year','v':dict(years=1)},
 {'name':'25 years','v':dict(years=25)},
 {'name':'past preset','preset':'past','v':{}},
 {'name':'cautious preset','preset':'cautious','v':{}},
 {'name':'USD mode default','cur':'USD','v':{}},
 {'name':'all zero','v':dict(start=0,monthly=0)},
 {'name':'negative start','v':dict(start='-100000')},
 {'name':'huge','v':dict(start='1000000000000',monthly='10000000')},
 {'name':'egx 100%','v':dict(egx=100)},
 {'name':'infl 0','v':dict(infl=0)},
 {'name':'infl -100','v':dict(infl=-100)},
 {'name':'years 0','v':dict(years=0)},
 {'name':'years 99','v':dict(years=99)},
 {'name':'text input','v':dict(start='abc',monthly='1,2,3')},
 {'name':'goal zero','v':dict(goal=0)},
 {'name':'goal covered','v':dict(goal=1000,start=1000000)},
]
r=subprocess.run(['node','qa/calc_test.js',json.dumps(scen)],capture_output=True,text=True,env=dict(os.environ,NODE_PATH=subprocess.check_output(['npm','root','-g'],text=True).strip()))
d=json.loads(r.stdout); json.dump(d,open('qa/calc_out.json','w'),indent=1)
print('page errors',d['errs'])
for x in d['res']:
    print('==',x['s']['name'],'| put',x['out']['put'],'| keep',x['out']['calc'],'| beat',x['out']['beat'],'|',x['out']['years'])
    for row in x['out']['rows']: print('   ',row[:5])
