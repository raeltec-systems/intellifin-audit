#!/usr/bin/env python3
"""Reproducible launch operating budget. Standard library only; does not call AWS."""
import argparse, copy, csv, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load(path):
    return json.loads(Path(path).read_text())

def model_rows(profile, rates, scale=1, override_observations=None, cache=False, uplift=1):
    rows = copy.deepcopy(profile['rows'])
    if override_observations is not None:
        for row in rows:
            if row['category']=='computer_observation_and_action_proposal':
                row['planned_calls']=profile['useful_computer_hours']*override_observations
    result=[]
    for row in rows:
        r=rates['models'][row['model']]
        count=row['planned_calls']*(1+profile['billable_redo_volume_fraction'])*scale
        text=row['input_text_tokens_per_call']; image=row['input_image_tokens_per_call']
        out=row['output_tokens_per_call_including_reasoning']
        threshold=r.get('long_context_threshold_input_tokens')
        long=threshold is not None and text+image>threshold
        im=r.get('long_input_multiplier',1) if long else 1
        om=r.get('long_output_multiplier',1) if long else 1
        text_rate=r['input_usd_per_million']
        if cache:
            text_rate=.4*text_rate+.5*r['cached_input_usd_per_million']+.1*r['cache_write_usd_per_million']
        price=((text*text_rate+image*r['input_usd_per_million'])*im+out*r['output_usd_per_million']*om)/1e6*uplift
        result.append((row['category']+' / '+row['model'],count,price,count*price))
    return result

def calculate(a,r,mr,mq,s,profile='base',evidence_months=1,observations=None,cache=False,uplift=1):
    lines=[]; n=s['active_users']; orgs=s['organisations']; h=a['hours_month']; d=a['desktop']; c=a['customer']; p=a['platform']; np=a['nonproduction']
    def add(cat,allocation,item,qty,key):
        rate=r[key]; val=qty*rate['value']
        lines.append(dict(scenario=s['id'],model_profile=profile,category=cat,allocation=allocation,item=item,quantity=qty,unit=rate['unit'],rate_key=key,unit_price_usd=rate['value'],cost_usd=val,source_url=rate['source_url']))
    def fixed(cat,allocation,item,qty,unit,price,key,source):
        lines.append(dict(scenario=s['id'],model_profile=profile,category=cat,allocation=allocation,item=item,quantity=qty,unit=unit,rate_key=key,unit_price_usd=price,cost_usd=qty*price,source_url=source))
    def fg(cat,allocation,name,count,cpu,gib,hours):
        add(cat,allocation,name+' CPU',count*cpu*hours,'fargate_cpu_hour');add(cat,allocation,name+' memory',count*gib*hours,'fargate_gib_hour')
    for role in ['api','worker','broker']:
        fg('Application compute','shared',role,s[role+'_replicas'],s[role+'_cpu_each'],s[role+'_gib_each'],h)
    fg('Computer platform','shared','gateway / guacd',p['gateway_replicas'],p['gateway_cpu_each'],p['gateway_gib_each'],h)
    fg('Computer platform','shared','egress proxy',p['proxy_replicas'],p['proxy_cpu_each'],p['proxy_gib_each'],h)
    add('Network platform','shared','NAT provisioned time',p['nat_gateways']*h,'nat_hour')
    add('Network platform','shared','Application load balancer',p['albs']*h,'alb_hour')
    add('Network platform','shared','Public IPv4 for ALB and NAT',p['public_ipv4']*h,'ipv4_hour')
    add('Network platform','shared','ECR API, ECR DKR, Logs endpoints, each in two AZs',p['interface_endpoint_az_count']*h,'endpoint_az_hour')
    add('Network platform','shared','Interface endpoint shared traffic',p['interface_endpoint_gb'],'endpoint_gb')
    add('Network platform','shared','ALB non-byte capacity headroom',p['alb_other_lcu_staffed_hour']*a['staffed_hours_month'],'alb_lcu_hour')
    add('Network platform','shared','Shared outgoing internet data',p['other_internet_out_gb'],'egress_gb_first_10tb')
    add('Network platform','shared','Shared NAT processing',p['other_nat_gb'],'nat_gb')
    add('Network platform','shared','Cross-AZ regional transfer charged sides',p['cross_az_gb']*p['cross_az_billable_sides'],'cross_az_gb_side')
    add('Database and durable storage','shared','RDS PostgreSQL18.1+ db.m9g.large Multi-AZ primary+standby',h,'rds_m9g_multi_hour')
    add('Database and durable storage','shared','RDS gp3 Multi-AZ provisioned storage (pair already priced)',s['rds_storage_gb'],'rds_gp3_multi_gb_month')
    add('Database and durable storage','shared','Excess RDS backup beyond included allocation',p['rds_backup_excess_gb'],'rds_backup_excess_gb_month')
    add('Database and durable storage','shared','Audit/service log archive and recovery objects',p['audit_storage_gb'],'s3_gb_month')
    add('Database and durable storage','shared','Audit archive writes',p['audit_s3_puts'],'s3_put')
    add('Database and durable storage','shared','Audit archive reads',p['audit_s3_gets'],'s3_get')
    metrics=p['custom_metrics_twenty'] if n>=20 else p['custom_metrics_small']
    for name,qty,key in [('Custom metric series',metrics,'metric_month'),('Standard alarm metrics',p['alarm_metrics'],'alarm_month'),('Dashboard',p['dashboards'],'dashboard_month'),('Metric API requests',p['metric_api_requests'],'cloudwatch_api_request'),('Shared logs ingested',p['logs_ingest_gb'],'logs_ingest_gb'),('Shared logs retained',p['logs_retained_gb'],'logs_storage_gb_month'),('Shared logs scanned',p['logs_query_gb'],'logs_query_gb'),('ECR image retention',p['ecr_gb'],'ecr_gb_month')]:add('Observability and operations','shared',name,qty,key)
    for name,qty,key in [('Shared KMS key versions',p['kms_key_versions'],'kms_key_version_month'),('Shared secrets',p['secrets'],'secret_month'),('Shared KMS calls',p['kms_requests'],'kms_request'),('Shared secret calls',p['secret_requests'],'secret_request'),('CloudTrail shared data events',p['cloudtrail_data_events'],'cloudtrail_data_event'),('GuardDuty management events',p['guardduty_events'],'guardduty_event'),('GuardDuty flow/DNS analysis',p['guardduty_flow_dns_gb'],'guardduty_flow_dns_gb'),('WAF ACL',p['waf_acls'],'waf_acl_month'),('WAF rules',p['waf_rules'],'waf_rule_month'),('WAF shared requests',p['waf_requests'],'waf_request'),('Image initial scans',p['image_initial_scans'],'inspector_image_initial'),('Image rescans',p['image_rescans'],'inspector_image_rescan')]:add('Security','shared',name,qty,key)
    for name,qty,key in [('Hosted zone',p['dns_zones'],'dns_zone_month'),('Shared DNS queries',p['dns_queries'],'dns_query'),('Platform admin authentication',p['admin_mau'],'cognito_essentials_mau'),('Shared notification emails',p['ses_recipients'],'ses_recipient'),('Shared email attachment bytes',p['ses_attachment_gb'],'ses_attachment_gb')]:add('Identity and delivery','shared',name,qty,key)
    spare=d['spare_count'] if n>=d['spare_threshold_users'] else 0
    add('Warm computer capacity','shared','Clean spare instance time',spare*d['spare_hours'],'linux_hour')
    add('Warm computer capacity','shared','Clean spare provisioned disk',spare*d['linux_disk_gb'],'ebs_gb_month')
    add('Warm computer capacity','shared','Clean spare Inspector scanning',spare*d['spare_hours'],'inspector_ec2_hour')
    add('Organisation custody','organisation','Tenant KMS key versions',orgs*c['kms_keys_org'],'kms_key_version_month')
    add('Organisation custody','organisation','Tenant connection secrets',orgs*c['secrets_org'],'secret_month')
    paid_hours=d['active_hours_user']+a['work_days']*(d['sessions_user_day']*d['grace_minutes']+d['prestart_minutes_user_day'])/60
    add('Active computers','customer','Customer Linux useful plus grace/prestart instance time',n*paid_hours,'linux_hour')
    add('Persistent customer data','customer','Retained Linux working disks',n*d['linux_disk_gb'],'ebs_gb_month')
    add('Persistent customer data','customer','Linux incremental snapshot stored data',n*d['linux_snapshot_gb'],'snapshot_gb_month')
    add('Persistent customer data','customer','Evidence, versions and separate recovery copy',n*c['primary_evidence_gb_user']*c['evidence_backup_and_versions_multiplier']*evidence_months,'s3_gb_month')
    add('Persistent customer data','customer','Evidence writes including recovery copy',n*c['evidence_puts_user'],'s3_put')
    add('Persistent customer data','customer','Evidence reads',n*c['evidence_gets_user'],'s3_get')
    fg('Analysis and conversion','customer','Isolated analysis/OCR/conversion',n,d['analysis_vcpu'],d['analysis_gib'],d['analysis_billable_hours_user'])
    media=n*d['view_hours_user']*3600*d['average_media_mbps']/8/1000*d['viewer_multiplier']
    out=media+n*d['other_internet_out_gb_user']
    add('Customer traffic','customer','Display and other internet outbound GB, gross paid rate',out,'egress_gb_first_10tb')
    add('Customer traffic','customer','ALB byte dimension LCU-hour budget',out,'alb_lcu_hour')
    add('Customer traffic','customer','Computer source and model/API NAT processing',n*(d['source_nat_gb_user']+c['platform_nat_gb_user']),'nat_gb')
    add('Customer traffic','customer','Customer Logs/ECR interface endpoint traffic',n*c['endpoint_gb_user'],'endpoint_gb')
    add('Customer traffic','customer','Cross-AZ charged customer GB-sides',n*c['cross_az_gb_user']*c['cross_az_billable_sides'],'cross_az_gb_side')
    for name,qty,key in [('Customer logs ingested',c['logs_ingest_gb_user'],'logs_ingest_gb'),('Customer logs retained',c['logs_retained_gb_user'],'logs_storage_gb_month'),('Customer logs scanned',c['logs_query_gb_user'],'logs_query_gb'),('KMS customer calls',c['kms_requests_user'],'kms_request'),('Customer secret retrieval calls',c['secret_requests_user'],'secret_request'),('Evidence CloudTrail events',c['cloudtrail_data_events_user'],'cloudtrail_data_event'),('GuardDuty customer management events',c['guardduty_events_user'],'guardduty_event'),('GuardDuty customer flow/DNS GB',c['guardduty_flow_dns_gb_user'],'guardduty_flow_dns_gb'),('Cognito active auditor',c['cognito_mau_user'],'cognito_essentials_mau'),('Notification recipients',c['ses_recipients_user'],'ses_recipient'),('Notification attachment GB',c['ses_attachment_gb_user'],'ses_attachment_gb'),('WAF customer HTTP requests',c['waf_requests_user'],'waf_request'),('Customer DNS queries',c['dns_queries_user'],'dns_query')]:add('Customer operations','customer',name,n*qty,key)
    add('Customer operations','customer','Inspector customer desktop hours',n*paid_hours,'inspector_ec2_hour')
    # A single separate nonproduction account, scheduled for 20 eight-hour workdays.
    fg('Nonproduction and CI','nonproduction','Nonproduction API/worker aggregate',1,np['app_cpu_total'],np['app_gib_total'],np['app_hours'])
    fg('Nonproduction and CI','nonproduction','Isolated regression analysis',1,np['analysis_vcpu'],np['analysis_gib'],np['analysis_hours'])
    fg('Nonproduction and CI','nonproduction','Nonproduction broker',1,np['broker_cpu'],np['broker_gib'],np['app_hours'])
    fg('Nonproduction and CI','nonproduction','Nonproduction egress proxy',1,np['proxy_cpu'],np['proxy_gib'],np['app_hours'])
    fg('Nonproduction and CI','nonproduction','Nonproduction gateway',1,np['gateway_cpu'],np['gateway_gib'],np['gateway_hours'])
    add('Nonproduction and CI','nonproduction','Isolated test ECR/Logs endpoint AZ-hours',np['interface_endpoint_az_hours'],'endpoint_az_hour')
    add('Nonproduction and CI','nonproduction','Isolated test endpoint traffic',np['endpoint_gb'],'endpoint_gb')
    np_map=[('rds_m9g_single_hours','rds_m9g_single_hour'),('rds_storage_gb','rds_gp3_single_gb_month'),('rds_backup_excess_gb','rds_backup_excess_gb_month'),('nat_hours','nat_hour'),('public_ipv4_hours','ipv4_hour'),('nat_gb','nat_gb'),('internet_out_gb','egress_gb_first_10tb'),('kms_keys','kms_key_version_month'),('secrets','secret_month'),('logs_ingest_gb','logs_ingest_gb'),('logs_retained_gb','logs_storage_gb_month'),('logs_query_gb','logs_query_gb'),('s3_gb','s3_gb_month'),('s3_puts','s3_put'),('s3_gets','s3_get'),('linux_test_hours','linux_hour'),('linux_disk_gb','ebs_gb_month'),('linux_snapshot_gb','snapshot_gb_month'),('codebuild_medium_minutes','codebuild_medium_minute')]
    for field,key in np_map:add('Nonproduction and CI','nonproduction',field.replace('_',' '),np[field],key)
    # Security/account setup and CI scans use the platform allowances above; no extra production copy.
    aws_shared=sum(x['cost_usd'] for x in lines if x['allocation']=='shared')
    aws_customer=sum(x['cost_usd'] for x in lines if x['allocation'] in ['customer','organisation'])
    def support(v):
        tiers=[(10000,r['support_first_tier_fraction']['value']),(70000,.07),(170000,.05),(float('inf'),.03)];result=0
        for width,fraction in tiers:
            used=min(v,width); result+=used*fraction;v-=used
            if v<=0:break
        return max(r['support_minimum']['value'],result)
    sf=support(aws_shared);sv=support(aws_shared+aws_customer)-sf
    fixed('AWS support','shared','Business Support+ baseline',1,'account-month',sf,'support_tier_calculation',r['support_minimum']['source_url'])
    fixed('AWS support','customer','Business Support+ incremental customer AWS use',1,'monthly incremental',sv,'support_tier_calculation',r['support_minimum']['source_url'])
    for item,qty,price,cost in model_rows(mq['scenarios'][profile],mr,n,observations,cache,uplift):fixed('Customer model APIs','customer',item,qty,'billable calls incl redo',price,'model token mix','MODEL-USAGE.md')
    embedding_rate=mr['embedding_models']['text-embedding-3-small']['input_usd_per_million']
    fixed('Customer model APIs','customer','Embedding newly acquired and query text',n*c['embedding_tokens_user']/1e6,'million input tokens',embedding_rate,'text-embedding-3-small','https://developers.openai.com/api/docs/models/text-embedding-3-small')
    speech_rate=mr['transcription_models']['gpt-transcribe']['usd_per_audio_minute']
    fixed('Customer model APIs','customer','Submitted speech transcription / gpt-transcribe',n*c['speech_input_minutes_user']*(1+c['speech_billable_redo_fraction']),'billed audio minutes',speech_rate,'gpt-transcribe','https://developers.openai.com/api/docs/models/gpt-transcribe')
    for item,qty,price,cost in model_rows(mq['shared_monthly_quality_evaluation'],mr,1,cache=cache,uplift=uplift):fixed('Shared quality evaluation','shared',item,qty,'billable calls incl redo',price,'model token mix','MODEL-USAGE.md')
    fixed('Connector entitlement','organisation','Incremental paid connector subscriptions (customer already owns source app)',orgs,'organisation-month',c['paid_connector_subscription_per_org'],'explicit scenario assumption','assumptions.json')
    totals={}
    for row in lines:totals[row['allocation']]=totals.get(row['allocation'],0)+row['cost_usd']
    categories={}
    for row in lines:categories[row['category']]=categories.get(row['category'],0)+row['cost_usd']
    total=sum(x['cost_usd'] for x in lines)
    return lines,dict(scenario=s['id'],active_users=n,organisations=orgs,model_profile=profile,shared_regional_usd=totals['shared'],nonproduction_usd=totals['nonproduction'],organisation_direct_usd=totals['organisation'],customer_consumption_usd=totals['customer'],customer_consumption_per_user_usd=totals['customer']/n,operating_cash_usd=total,per_active_user_fully_allocated_usd=total/n,planning_cash_with_contingency_usd=total*(1+a['contingency_fraction']),categories=categories)

def write_csv(path,rows):
    with path.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--assumptions',type=Path,default=ROOT/'assumptions.json');ap.add_argument('--output',type=Path,default=ROOT);args=ap.parse_args()
    a=load(args.assumptions);r=load(ROOT/'rates.json')['rates'];mr=load(ROOT/'model-rates.json');mq=load(ROOT/'model-quantities.json');out=args.output;out.mkdir(parents=True,exist_ok=True)
    all_lines=[];results=[]
    for s in a['scenarios']:
        for profile in ['light','base','heavy']:
            lines,res=calculate(a,r,mr,mq,s,profile);all_lines.extend(lines);results.append(res)
    write_csv(out/'line-items.csv',all_lines)
    flat=[{k:round(v,6) if isinstance(v,float) else v for k,v in row.items() if k!='categories'} for row in results]
    write_csv(out/'results.csv',flat)
    (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    sensitivities=[]
    for s in a['scenarios']:
        base=next(z for z in results if z['scenario']==s['id'] and z['model_profile']=='base')
        changes=[('12 months accumulated evidence at same20GB/user/month; no deletion',{},dict(evidence_months=12)),('Dense computer:360 observations/useful hour; other base tokens unchanged',{},dict(observations=360)),('Illustrative50%textcachehits10%writes',{},dict(cache=True)),('Uniform10%eligible model regional-processing uplift',{},dict(uplift=1.1)),('One person per organisation; regional resources still once',{'organisations':s['active_users']},{})]
        for label,scchange,kwargs in changes:
            ss=copy.deepcopy(s);ss.update(scchange);_,res=calculate(a,r,mr,mq,ss,**kwargs)
            sensitivities.append(dict(scenario=s['id'],case=label,operating_cash_usd=round(res['operating_cash_usd'],6),delta_from_base_usd=round(res['operating_cash_usd']-base['operating_cash_usd'],6)))
    # Qualified Windows option replaces two existing Linux profiles in the20-person case.
    w=a['windows_optional'];paid=a['desktop']['active_hours_user']+a['work_days']*(a['desktop']['sessions_user_day']*a['desktop']['grace_minutes']+a['desktop']['prestart_minutes_user_day'])/60
    win=[('Windows compute delta versus Linux',w['named_users']*paid*(r['windows_hour']['value']-r['linux_hour']['value'])),('Working disk delta',w['named_users']*(w['disk_gb_user']-a['desktop']['linux_disk_gb'])*r['ebs_gb_month']['value']),('Snapshot delta',w['named_users']*(w['snapshot_gb_user']-a['desktop']['linux_snapshot_gb'])*r['snapshot_gb_month']['value']),('Per-organisation AD controllers',w['organisations']*w['directory_controllers']*a['hours_month']*r['ad_dc_hour']['value']),('Per-organisation license endpoint AZs',w['organisations']*w['endpoint_az_count']*a['hours_month']*r['endpoint_az_hour']['value']),('Windows endpoint GB',w['named_users']*w['endpoint_gb_user']*r['endpoint_gb']['value']),('Dedicated Windows VPC NAT gateways',w['organisations']*w['extra_nat_gateways']*a['hours_month']*r['nat_hour']['value']),('Dedicated Windows VPC NAT publicIPv4',w['organisations']*w['extra_nat_ipv4']*a['hours_month']*r['ipv4_hour']['value']),('Office Standard named users',w['named_users']*r['office_standard_user_month']['value']),('RDS SAL named users',w['named_users']*r['rds_sal_user_month']['value'])]
    aws_delta=sum(v for k,v in win if not k.startswith(('Office','RDS SAL'))); win.append(('Incremental Business Support+ on eligible AWS usage',aws_delta*r['support_first_tier_fraction']['value']))
    write_csv(out/'windows-option.csv',[dict(item=k,monthly_delta_usd=round(v,6)) for k,v in win])
    write_csv(out/'sensitivity.csv',sensitivities)
    rows=['| Active people | Shared regional platform + quality | Nonproduction/CI | Organisation custody | Customer consumption | Monthly operating cash | With15% planning contingency |','|---:|---:|---:|---:|---:|---:|---:|']
    for x in results:
        if x['model_profile']=='base':rows.append('| '+str(x['active_users'])+' | '+' | '.join(f"${x[k]:,.2f}" for k in ['shared_regional_usd','nonproduction_usd','organisation_direct_usd','customer_consumption_usd','operating_cash_usd','planning_cash_with_contingency_usd'])+' |')
    (out/'base-table.md').write_text('\n'.join(rows)+'\n')
    print('\n'.join(rows));print('Two Windows profiles incremental:',round(sum(v for _,v in win),2))
if __name__=='__main__':main()
