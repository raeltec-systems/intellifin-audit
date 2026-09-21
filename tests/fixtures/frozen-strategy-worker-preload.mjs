// TEST ONLY: hold the synthetic model response at an eligible fallback until the
// authenticated UI queues a selection. Browser/search/evidence/action persistence
// remain the actual compiled worker path. No tool or observation is injected here.
import { createSqlClient } from '../../packages/infrastructure/dist/index.js';
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-strategy-interception' || !process.env.STRATEGY_PROOF_VERSION_ID)
  throw new Error('Frozen strategy preload requires its dedicated fixture configuration.');
const realFetch=globalThis.fetch;
let sequence=0;
globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(new URL(url).hostname!=='api.anthropic.com')return realFetch(input,init);
  const body=JSON.parse(init?.body??await input.text());
  const content=body.messages.at(-1)?.content;
  const envelope=JSON.parse(typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join(''));
  if((envelope.phase??'actions')!=='actions'||!Array.isArray(envelope.tools))throw new Error('Unexpected strategy proof model phase.');
  const tool=envelope.tools.find(tool=>tool.action==='search')??envelope.tools.find(tool=>tool.action==='navigate')??envelope.tools.find(tool=>tool.action==='read-attribute');
  if(!tool)throw new Error('No approved strategy proof action.');
  const sql=createSqlClient(process.env.DATABASE_URL,{max:1});
  try{
    const [opportunity]=await sql`SELECT c.run_id,c.opportunity_id FROM run_strategy_cursor c JOIN audit_run r ON r.run_id=c.run_id WHERE r.version_id=${process.env.STRATEGY_PROOF_VERSION_ID} AND c.opportunity_id IS NOT NULL`;
    if(opportunity){
      process.stdout.write('Synthetic strategy provider:awaiting-confirmation\n');
      const deadline=Date.now()+110000;
      let ready=false;
      while(Date.now()<deadline){
        const rows=await sql`SELECT 1 FROM run_strategy_selection s JOIN run_strategy_transition t ON t.command_id=s.command_id WHERE s.run_id=${opportunity.run_id} AND s.opportunity_id=${opportunity.opportunity_id} AND t.state='queued'`;
        if(rows.length){ready=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!ready)throw new Error('Strategy confirmation deadline expired.');
      process.stdout.write('Synthetic strategy provider:confirmation-recorded\n');
    }
  }finally{await sql.end({timeout:3});}
  process.stdout.write(`Synthetic absence provider:${JSON.stringify({action:tool.action,opaqueTool:true})}\n`);
  return new Response(JSON.stringify({id:`msg_strategy_${++sequence}`,type:'message',role:'assistant',model:body.model,
    content:[{type:'text',text:JSON.stringify({actions:[{toolId:tool.toolId,parameters:[]}],uncertainty:{kind:'none',rationale:null}})}],
    stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:100}}),{status:200,headers:{'content-type':'application/json'}});
};
