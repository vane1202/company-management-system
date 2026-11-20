import { Router,type Request,type Response,type NextFunction } from 'express';
import type { Pool,PoolClient } from 'pg';
import { withTransaction } from '../db.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../types.js';
import { amount,dateField,hashPayload,replay,textField,uuid } from '../lib/commerce.js';
import { addMoney,centsToMoney,moneyToCents } from '../lib/money.js';
import { writeAudit } from '../audit.js';

export function createAdAccountsRouter(db:Pool,config:AppConfig) {
  const router=Router();
  router.use((req,_res,next)=>['boss','ops','finance'].includes(req.actor!.role)?next():next(new HttpError(403,'无广告账户权限')));
  const mutate=(handler:(c:PoolClient,req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{
    if(!['ops','finance'].includes(req.actor!.role)){next(new HttpError(403,'仅运营或财务可登记广告账户流水'));return;}
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.json(result))
      .catch(next);
  };
  router.get('/', (_req, res, next) => {
    void withTransaction(db, async (c) => {
      const accounts=(await c.query(`SELECT a.*,COALESCE((SELECT sum(t.credited_usd) FROM ad_topups t WHERE t.account_ref=a.code AND t.voided_at IS NULL),0)::numeric(14,2) AS topped_usd,COALESCE((SELECT sum(r.spend_usd) FROM ops_reports r WHERE r.ad_account_ref=a.code AND r.business_date>=a.opened_on),0)::numeric(14,2) AS spent_usd FROM ad_accounts a ORDER BY a.code`)).rows.map(a=>({...a,balance_usd:centsToMoney(moneyToCents(a.opening_usd)+moneyToCents(a.topped_usd)-moneyToCents(a.spent_usd))}));
      const topups=(await c.query('SELECT * FROM ad_topups ORDER BY paid_on DESC,created_at DESC')).rows;
      return {accounts,topups,summary:{paidCny:addMoney(topups.filter(t=>!t.voided_at).map(t=>t.paid_cny)),creditedUsd:addMoney(topups.filter(t=>!t.voided_at).map(t=>t.credited_usd)),spentUsd:addMoney(accounts.map(a=>a.spent_usd)),balanceUsd:addMoney(accounts.map(a=>a.balance_usd))}};
    }, true).then((result) => res.json(result)).catch(next);
  });
  router.post('/',mutate(async(c,req)=>{
    const b=req.body??{},body={code:textField(b.code,'广告账户编号',64),name:textField(b.name,'广告账户名称'),openedOn:dateField(b.openedOn,config.businessTimezone),openingUsd:amount(b.openingUsd??'0','启用日期期初余额')};
    await c.query('INSERT INTO ad_accounts(code,name,opened_on,opening_usd,created_by) VALUES($1,$2,$3,$4,$5)',[body.code,body.name,body.openedOn,body.openingUsd,req.actor!.id]);
    await writeAudit(c,{actorId:req.actor!.id,action:'ad_account_create',entityType:'ad_account',entityId:body.code,after:body,ip:req.ip});return{code:body.code};
  }));
  router.post('/rename',mutate(async(c,req)=>{
    if(req.actor!.role!=='ops')throw new HttpError(403,'仅运营可修改广告户名称');
    const code=textField(req.body?.code,'广告账户编号',64);
    const name=textField(req.body?.name,'广告账户名称',128);
    const prior=(await c.query<{name:string}>('SELECT name FROM ad_accounts WHERE code=$1 FOR UPDATE',[code])).rows[0];
    if(!prior)throw new HttpError(404,'广告账户不存在');
    if(prior.name!==name){
      await c.query('UPDATE ad_accounts SET name=$2 WHERE code=$1',[code,name]);
      await writeAudit(c,{actorId:req.actor!.id,action:'ad_account_rename',entityType:'ad_account',entityId:code,before:{name:prior.name},after:{name},ip:req.ip});
    }
    return {code};
  }));
  router.post('/topups',mutate(async(c,req)=>{
    const b=req.body??{},body={accountRef:textField(b.accountRef,'广告账户编号',64),paidOn:dateField(b.paidOn,config.businessTimezone),creditedUsd:amount(b.creditedUsd,'广告户实增美元',true),paidCny:amount(b.paidCny,'实际人民币支付',true),paymentAccount:textField(b.paymentAccount,'付款账户'),reference:textField(b.reference,'付款流水号'),note:textField(b.note??'','备注',500,false)};
    const a=(await c.query('SELECT * FROM ad_accounts WHERE code=$1 FOR UPDATE',[body.accountRef])).rows[0];if(!a)throw new HttpError(404,'广告账户不存在');if(body.paidOn<String(a.opened_on))throw new HttpError(400,'充值早于账户期初日期');
    const hash=hashPayload(body),old=await replay(c,'ad_topups',uuid(b.requestKey),hash);if(old)return{id:old.id,replayed:true};
    const t=(await c.query('INSERT INTO ad_topups(account_ref,paid_on,credited_usd,paid_cny,payment_account,reference,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[body.accountRef,body.paidOn,body.creditedUsd,body.paidCny,body.paymentAccount,body.reference,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    await writeAudit(c,{actorId:req.actor!.id,action:'ad_topup_create',entityType:'ad_account',entityId:body.accountRef,after:{id:t.id,...body},ip:req.ip});return{id:t.id};
  }));
  router.post('/topups/:id/void',mutate(async(c,req)=>{
    const id=uuid(req.params.id),reason=textField(req.body?.reason,'作废原因',500),t=(await c.query('SELECT * FROM ad_topups WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!t)throw new HttpError(404,'充值不存在');if(t.voided_at)return{id};
    await c.query('UPDATE ad_topups SET voided_at=now(),void_reason=$2 WHERE id=$1',[id,reason]);await writeAudit(c,{actorId:req.actor!.id,action:'ad_topup_void',entityType:'ad_account',entityId:t.account_ref,after:{id,reason},ip:req.ip});return{id};
  }));return router;
}
