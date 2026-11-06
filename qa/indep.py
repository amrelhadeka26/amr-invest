# Independent model of the published method: monthly compounding of an annual rate,
# deposits at month end, buy fee on money in, yearly fee taken off the annual rate, sell fee at the end.
import json,subprocess,os,sys
def fv(start,monthly,years,annual,buy=0,sell=0,yearly=0,raise_=0,fxm=None,rate_fn=None):
    v=start*(1-buy/100); d=monthly
    for m in range(1,years*12+1):
        if fxm: d*=fxm
        a=rate_fn(m) if rate_fn else annual
        r=(1+(a-yearly)/100)**(1/12)-1
        v=v*(1+r)+d*(1-buy/100)
        if m%12==0: d*=1+raise_/100
    return v*(1-sell/100)
def closed(start,monthly,years,annual):
    r=(1+annual/100)**(1/12)-1; n=years*12
    return start*(1+r)**n + (monthly*(((1+r)**n-1)/r) if r else monthly*n)
num=lambda s: float(s.replace(',','').replace('$','').replace('−','-').replace('+',''))
