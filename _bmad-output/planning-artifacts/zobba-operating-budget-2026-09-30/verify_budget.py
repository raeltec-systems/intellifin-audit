#!/usr/bin/env python3
"""Independent Decimal checks of authored budget; no production code or cloud calls."""
import csv, json, re
from collections import defaultdict
from decimal import Decimal as D
from pathlib import Path

P=Path(__file__).resolve().parent
A=json.loads((P/'assumptions.json').read_text());R=json.loads((P/'rates.json').read_text())['rates'];MR=json.loads((P/'model-rates.json').read_text());MQ=json.loads((P/'model-quantities.json').read_text())
rows=list(csv.DictReader((P/'line-items.csv').open()));results=json.loads((P/'results.json').read_text())
checks=0

def close(x,y,tolerance='0.000001'):
    global checks
    assert abs(D(str(x))-D(str(y)))<=D(tolerance),(x,y)
    checks+=1

# Independently multiply every billed line and reconcile all alternatives.
bycase=defaultdict(list)
for row in rows:
    close(D(row['quantity'])*D(row['unit_price_usd']),row['cost_usd'])
    assert D(row['quantity'])>=0 and D(row['cost_usd'])>=0
    bycase[(row['scenario'],row['model_profile'])].append(row)
    if row['rate_key'] in R:
        close(row['unit_price_usd'],R[row['rate_key']]['value'])
        assert row['source_url']==R[row['rate_key']]['source_url']
for res in results:
    case=bycase[(res['scenario'],res['model_profile'])]
    close(sum(D(x['cost_usd']) for x in case),res['operating_cash_usd'])
    close(D(str(res['operating_cash_usd']))*(1+D(str(A['contingency_fraction']))),res['planning_cash_with_contingency_usd'])
    for allocation,key in [('shared','shared_regional_usd'),('nonproduction','nonproduction_usd'),('organisation','organisation_direct_usd'),('customer','customer_consumption_usd')]:close(sum(D(x['cost_usd']) for x in case if x['allocation']==allocation),res[key])
    # Gross production AWS-only base: exclude models, quality, test account and already computed support.
    aws=sum(D(x['cost_usd']) for x in case if x['allocation']!='nonproduction' and x['category'] not in ['AWS support','Customer model APIs','Shared quality evaluation','Connector entitlement'])
    assert aws<D('10000')
    paid=sum(D(x['cost_usd']) for x in case if x['category']=='AWS support')
    close(paid,max(D('29'),aws*D('.09')))
    assert sum(x['item']=='NAT provisioned time' for x in case)==1
    assert sum(x['item'].startswith('RDS PostgreSQL18.1+') for x in case)==1
    assert sum(x['item']=='evaluation_case_work / gpt-6.1-sol' for x in case)==1
    close(next(x['quantity'] for x in case if x['item']=='NAT provisioned time'),1460)
    close(next(x['quantity'] for x in case if x['item']=='Customer Linux useful plus grace/prestart instance time'),70*res['active_users'])

# Independent model arithmetic, including reasoning output and image input.
goldens={'light':D('24.1725'),'base':D('196.128'),'heavy':D('1646.7975')}
for profile in ['light','base','heavy']:
    q=MQ['scenarios'][profile];total=D(0);inputs=D(0);outputs=D(0)
    for row in q['rows']:
        rate=MR['models'][row['model']];calls=D(row['planned_calls'])*(1+D(str(q['billable_redo_volume_fraction'])))
        inp=D(row['input_text_tokens_per_call'])+D(row['input_image_tokens_per_call']);out=D(row['output_tokens_per_call_including_reasoning'])
        total+=calls*(inp*D(str(rate['input_usd_per_million']))+out*D(str(rate['output_usd_per_million'])))/D(1000000)
        inputs+=calls*inp;outputs+=calls*out
    close(total,goldens[profile])
    if profile=='base':close(inputs,65760000);close(outputs,8448000)
close(D(60)*D('1.2')*D(str(MR['transcription_models']['gpt-transcribe']['usd_per_audio_minute'])),'0.324')
# Data-transform edge: cache writes replace the uncached price for those tokens.
cache=D(0)
for row in MQ['scenarios']['base']['rows']:
    rate=MR['models'][row['model']];calls=D(row['planned_calls'])*D('1.2')
    mixed=D('.4')*D(str(rate['input_usd_per_million']))+D('.5')*D(str(rate['cached_input_usd_per_million']))+D('.1')*D(str(rate['cache_write_usd_per_million']))
    cache+=calls*(D(row['input_text_tokens_per_call'])*mixed+D(row['input_image_tokens_per_call'])*D(str(rate['input_usd_per_million']))+D(row['output_tokens_per_call_including_reasoning'])*D(str(rate['output_usd_per_million'])))/D(1000000)
close(cache,'146.55360')
close(D(800)*D('1.2')*(D(30000)*2+D(5000)*10)/D(1000000)+D(200)*D('1.2')*(D(40000)*4+D(8000)*20)/D(1000000),'182.40')

# Selected catalogue evidence actually agrees with the priced keys and exact billing dimension.
for entry in json.loads((P/'sources/aws-selected-rate-evidence.json').read_text()):
    rate=R[entry['rate_key']];dim=entry['selected_dimension']
    close(rate['value'],dim['pricePerUnit']['USD'])
    assert rate['sku']==entry['product']['sku'] and rate['unit']==dim['unit']
    assert rate['rate_code']==dim['rateCode']
# Cloud services are not multiplied by organisation count in small-firm sensitivity.
sens=list(csv.DictReader((P/'sensitivity.csv').open()))
for row in sens:
    if row['case'].startswith('One person per organisation'):
        n=next(s['active_users'] for s in A['scenarios'] if s['id']==row['scenario'])
        close(row['delta_from_base_usd'],D(n-1)*D('1.8')*D('1.09'))
windows=list(csv.DictReader((P/'windows-option.csv').open()))
close(sum(D(x['monthly_delta_usd']) for x in windows),'312.5858')
# Authored file links stay usable when the package is checked out beside the accepted design.
for path in P.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
        if re.match(r'^[a-z]+://',target) or target.startswith('#'):continue
        target=target.split('#')[0]
        assert (path.parent/target).exists(),(path,target)
print(f'PASS: {checks} independent arithmetic/rate checks; all 9 scenarios, support base, model goldens, shared allocation, Windows delta and local document links. No benchmark, deployment or billing-account verification was performed.')
