import { Router } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { businessToday, diffDays, isIsoDate, toDateOnly } from '../lib/dates.js';
import { leadMetrics, leadPayload, type Lead } from '../lib/fanLeads.js';
import { parseAccountId,assertServiceChannel } from '../lib/csAccounts.js';
import { managedTeamIds, membershipOnDate, type Actor } from '../users.js';
import { getBackfillDays } from '../settings.js';
import { writeAudit } from '../audit.js';
import { HttpError } from '../types.js';

function serialize(r:Record<string,any>):Lead{return {id:r.id,accountId:r.user_id,wechatId:r.wechat_id??r.display_name,teamId:r.team_id,teamName:r.team_name,receivedOn:toDateOnly(r.received_on),pageName:r.page_name,personaCode:r.persona_code,operatorName:r.operator_name,channel:r.channel,customerLabel:r.customer_label,customerRef:r.customer_ref,contactStatus:r.contact_status,repliedOn:r.replied_on?toDateOnly(r.replied_on):null,qualifiedOn:r.qualified_on?toDateOnly(r.qualified_on):null,needSummary:r.need_summary,invalidReason:r.invalid_reason,lossReason:r.loss_reason,nextFollowup:r.next_followup?toDateOnly(r.next_followup):null,note:r.note,version:r.version,voidedAt:r.voided_at,voidReason:r.void_reason};}
const select=`SELECT l.*,u.service_account_label AS wechat_id,u.display_name,t.name AS team_name FROM fan_leads l JOIN users u ON u.id=l.user_id JOIN teams t ON t.id=l.team_id`;
async function assertRead(db:Pool,actor:Actor,row:Record<string,any>){
  if(actor.role==='boss'||(actor.role==='cs'&&actor.id===row.user_id))return;
  if(actor.role==='cs_supervisor'&&(await managedTeamIds(db,actor)).includes(row.team_id))return;
  throw new HttpError(403,'无权查看此客户线索');
}
export function createFanLeadsRouter(db:Pool,config:AppConfig){
  const router=Router();
  router.get('/',async(req,res,next)=>{try{
    const actor=req.actor!,today=businessToday(new Date(),config.businessTimezone),from=String(req.query.from??today),to=String(req.query.to??today);
    if(!isIsoDate(from)||!isIsoDate(to)||from>to||to>today||diffDays(from,to)>366)throw new HttpError(400,'承接日期范围无效（最多367天，不能晚于今天）');
    if(!['boss','cs_supervisor','cs'].includes(actor.role))throw new HttpError(403,'无权查看客户线索');
    const ids=actor.role==='cs_supervisor'?await managedTeamIds(db,actor):[];
    const params:any[]=[from,to];let scope='';
    if(actor.role==='cs'){params.push(actor.id);scope+=` AND l.user_id=$${params.length}`;}
    if(actor.role==='cs_supervisor'){params.push(ids);scope+=` AND l.team_id=ANY($${params.length}::uuid[])`;}
    const reportParams=[...params],reportScope=scope;
    const allowed=new Set(['accountId','teamId','pageName','personaCode','operatorName','channel']);
    const columns:Record<string,string>={accountId:'l.user_id',teamId:'l.team_id',pageName:'l.page_name',personaCode:'l.persona_code',operatorName:'l.operator_name',channel:'l.channel'};
    for(const key of allowed){const value=String(req.query[key]??'');if(!value)continue;if(key==='accountId'||key==='teamId')parseAccountId(value);params.push(value);scope+=` AND ${columns[key]}=$${params.length}`;}
    const c=await db.connect();try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const count=Number((await c.query('SELECT count(*) AS n FROM fan_leads l WHERE received_on BETWEEN $1 AND $2'+scope,params)).rows[0].n);
      if(count>10000)throw new HttpError(400,'线索超过10000条，请缩小日期或接待账号范围');
      const rows=(await c.query(select+' WHERE received_on BETWEEN $1 AND $2'+scope+' ORDER BY received_on DESC,l.created_at DESC',params)).rows.map(serialize);
      const reports=(await c.query(`SELECT l.user_id AS "accountId",l.page_name AS "pageName",l.business_date::text AS "businessDate",l.ms_today AS "msToday",l.ws_today AS "wsToday",l.added_count AS "addedCount" FROM fan_reports l WHERE l.business_date BETWEEN $1 AND $2`+reportScope,reportParams)).rows;
      const groups=[...new Set(rows.map(r=>r.accountId))].map(id=>{const list=rows.filter(r=>r.accountId===id);return {accountId:id,wechatId:list[0].wechatId,teamNames:[...new Set(list.map(r=>r.teamName))],...leadMetrics(list,today)};});
      await c.query('COMMIT');res.json({from,to,today,totals:leadMetrics(rows,today),accounts:groups,leads:rows,reports});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }catch(e){next(e);}});
  router.get('/:id/history',async(req,res,next)=>{try{
    const id=parseAccountId(req.params.id),row=(await db.query(select+' WHERE l.id=$1',[id])).rows[0];if(!row)throw new HttpError(404,'线索不存在');await assertRead(db,req.actor!,row);
    const history=(await db.query("SELECT a.created_at,a.action,a.before_data,a.after_data,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE entity_type='fan_lead' AND entity_id=$1 ORDER BY a.created_at DESC",[id])).rows;
    res.json({history});
  }catch(e){next(e);}});
  router.post('/',async(req,res,next)=>{try{
    const actor=req.actor!;if(actor.role!=='cs')throw new HttpError(403,'客户线索由对应客服接待账号填报');
    const today=businessToday(new Date(),config.businessTimezone),p=leadPayload(req.body,today),requestKey=parseAccountId(req.body?.requestKey);
    assertServiceChannel(actor.servicePlatform,p.channel);
    const days=await getBackfillDays(db,config.fanReportBackfillDays);if(diffDays(p.receivedOn,today)>=days)throw new HttpError(403,`新增承接仅可补报近${days}天`);
    const membership=await membershipOnDate(db,actor.id,p.receivedOn);if(!membership)throw new HttpError(400,'该承接日期没有小组归属');
    const c=await db.connect();try{await c.query('BEGIN');
      // 请求键避免手机重复提交；事务内唯一冲突后再读取已完成请求。
      const values=[requestKey,actor.id,membership.team_id,p.receivedOn,p.pageName,p.personaCode,p.operatorName,p.channel,p.customerLabel,p.customerRef,p.contactStatus,p.repliedOn,p.qualifiedOn,p.needSummary,p.invalidReason,p.lossReason,p.nextFollowup,p.note,actor.id];
      const row=(await c.query(`INSERT INTO fan_leads(request_key,user_id,team_id,received_on,page_name,persona_code,operator_name,channel,customer_label,customer_ref,contact_status,replied_on,qualified_on,need_summary,invalid_reason,loss_reason,next_followup,note,created_by,updated_by) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')},$19) ON CONFLICT(request_key) DO NOTHING RETURNING *`,values)).rows[0];
      if(!row){const old=(await c.query('SELECT id,user_id FROM fan_leads WHERE request_key=$1',[requestKey])).rows[0];if(old?.user_id!==actor.id)throw new HttpError(409,'请求键已使用');await c.query('COMMIT');res.json({id:old.id});return;}
      await writeAudit(c,{actorId:actor.id,action:'fan_lead_create',entityType:'fan_lead',entityId:row.id,after:row,ip:req.ip});await c.query('COMMIT');res.json({id:row.id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }catch(e){next(e);}});
  router.patch('/:id',async(req,res,next)=>{try{
    const actor=req.actor!;if(actor.role!=='cs')throw new HttpError(403,'客户跟进由对应客服接待账号填报');
    if(req.body?.void!==undefined&&typeof req.body.void!=='boolean')throw new HttpError(400,'作废状态无效');
    const id=parseAccountId(req.params.id),reason=String(req.body?.reason??'').trim();if(!reason||reason.length>500)throw new HttpError(400,'须填写本次跟进/修正说明，最多500字');
    const c=await db.connect();try{await c.query('BEGIN');const old=(await c.query('SELECT * FROM fan_leads WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!old)throw new HttpError(404,'线索不存在');if(old.user_id!==actor.id)throw new HttpError(403,'只能跟进本接待账号客户');if(old.voided_at)throw new HttpError(409,'已作废线索不能再次修改');if(old.version!==req.body?.version)throw new HttpError(409,'记录已更新，请重新加载');
      if(req.body?.void===true){await c.query('UPDATE fan_leads SET voided_at=now(),void_reason=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1',[id,reason,actor.id]);}
      else{const p=leadPayload(req.body,businessToday(new Date(),config.businessTimezone),toDateOnly(old.received_on));assertServiceChannel(actor.servicePlatform,p.channel);const values=[p.pageName,p.personaCode,p.operatorName,p.channel,p.customerLabel,p.customerRef,p.contactStatus,p.repliedOn,p.qualifiedOn,p.needSummary,p.invalidReason,p.lossReason,p.nextFollowup,p.note,actor.id,id];await c.query(`UPDATE fan_leads SET page_name=$1,persona_code=$2,operator_name=$3,channel=$4,customer_label=$5,customer_ref=$6,contact_status=$7,replied_on=$8,qualified_on=$9,need_summary=$10,invalid_reason=$11,loss_reason=$12,next_followup=$13,note=$14,updated_by=$15,updated_at=now(),version=version+1 WHERE id=$16`,values);}
      const after=(await c.query('SELECT * FROM fan_leads WHERE id=$1',[id])).rows[0];await writeAudit(c,{actorId:actor.id,action:req.body?.void?'fan_lead_void':'fan_lead_followup',entityType:'fan_lead',entityId:id,before:old,after:{...after,reason},ip:req.ip});await c.query('COMMIT');res.json({id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }catch(e){next(e);}});
  return router;
}
