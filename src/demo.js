'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {atomicJson}=require('./util');
const {defaults}=require('./config');
async function seedDemo(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'token-meter-demo-'));
  const roots={antigravity:[path.join(dir,'fixtures','antigravity')],generic:[],codex:[path.join(dir,'fixtures','codex')],claude:[path.join(dir,'fixtures','claude')],gemini:[path.join(dir,'fixtures','gemini')]};
  await atomicJson(path.join(dir,'config.json'),{...defaults(),roots,dailyBudgetUsd:10});
  await atomicJson(path.join(dir,'prices.user.json'),{version:1,rules:[]});
  for(const list of Object.values(roots))if(list.length)await fs.mkdir(list[0],{recursive:true});
  const now=Date.now();
  for(let session=0;session<3;session++){
    let totals={input_tokens:0,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:0};
    const id=`demo-codex-${session}`,cwd=session===1?'/demo/card-news-bot':'/demo/news-site';
    const lines=[{timestamp:new Date(now-7200000).toISOString(),type:'session_meta',payload:{id,cwd,model_provider:'openai',...(session===2?{parent_thread_id:'demo-codex-0'}:{})}}];
    for(let i=0;i<12;i++){
      const timestamp=new Date(now-(36-session*12-i)*140000).toISOString();
      const model=session===2?'gpt-6-sol':'gpt-6-luna',effort=session===2?'high':i<8?'high':'xhigh';
      const usage={input_tokens:22000+i*2300,cached_input_tokens:13000+i*1700,cache_write_input_tokens:0,output_tokens:1700+i*130,reasoning_output_tokens:1100+i*70};usage.total_tokens=usage.input_tokens+usage.output_tokens;
      for(const k of Object.keys(totals))totals[k]+=usage[k];
      lines.push({timestamp,type:'turn_context',payload:{model,effort,turn_id:`turn-${session}-${i}`,cwd}});
      const event={timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{...totals},last_token_usage:usage,model_context_window:1000000}}};lines.push(event);if(i%4===0)lines.push(event);
    }
    await fs.writeFile(path.join(roots.codex[0],`rollout-${id}.jsonl`),lines.map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
  for(let session=0;session<2;session++){
    const lines=[];
    for(let i=0;i<10;i++){
      const row={type:'assistant',sessionId:`demo-claude-${session}`,requestId:`demo-req-${session}-${i}`,timestamp:new Date(now-(22-session*10-i)*120000).toISOString(),cwd:session?'/demo/card-news-bot':'/demo/news-site',isSidechain:!!session,agentId:session?'reviewer':undefined,message:{id:`demo-msg-${session}-${i}`,model:session?'claude-opus-5-5':'claude-sonnet-5',stop_reason:'end_turn',content:[{type:'text',text:'SYNTHETIC_DEMO_PROMPT_MUST_NOT_PERSIST'}],usage:{input_tokens:3500+i*150,output_tokens:1400+i*110,cache_read_input_tokens:16000+i*1300,cache_creation_input_tokens:4000,cache_creation:{ephemeral_5m_input_tokens:4000,ephemeral_1h_input_tokens:0}}}};
      lines.push(row);if(i%3===0)lines.push(row);
    }
    await fs.writeFile(path.join(roots.claude[0],`demo-claude-${session}.jsonl`),lines.map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
  for(let session=0;session<2;session++){
    const messages=[];
    for(let i=0;i<8;i++){const input=26000+i*1700,output=1200+i*100,thoughts=2400+i*170;messages.push({id:`demo-gemini-${session}-${i}`,type:'gemini',timestamp:new Date(now-(17-session*8-i)*160000).toISOString(),model:'gemini-3.5-flash',tokens:{input,output,thoughts,cached:16000+i*1000,total:input+output+thoughts,tool:0},content:'SYNTHETIC_DEMO_PROMPT_MUST_NOT_PERSIST'});}
    const meta={sessionId:`demo-gemini-${session}`,projectHash:`demo-gemini-project-${session}`,directories:[session?'/demo/card-news-bot':'/demo/news-site'],kind:'main'};
    if(session===0)await atomicJson(path.join(roots.gemini[0],'session-demo-legacy.json'),{...meta,messages});
    else await fs.writeFile(path.join(roots.gemini[0],'session-demo-current.jsonl'),[meta,...messages].map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
  require('./demo-antigravity').seedAntigravityDemo(roots.antigravity[0],now);
  return dir;
}
module.exports={seedDemo};
