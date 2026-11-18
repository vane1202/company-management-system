import {Router,type Request} from 'express';
import type {Pool,PoolClient} from 'pg';
import { withTransaction } from '../db.js';
import type {AppConfig} from '../config.js';
import {HttpError} from '../types.js';
import {amount,dateField,hashPayload,replay,textField,uuid} from '../lib/commerce.js';
import {writeAudit} from '../audit.js';

export function createPaidPerformanceRouter(db:Pool,config:AppConfig){
 const router=Router();
 router.get('/',async(_req,res,next)=>{try{res.json({records:(await db.query('SELECT p.*,u.display_name AS created_by_name FROM live_paid_performance p JOIN users u ON u.id=p.created_by ORDER BY p.business_date DESC,p.created_at DESC')).rows});}catch(e){next(e);}});
 const mutate=(fn:(c:PoolClient,req:Request)=>Promise<unknown>):import('express').RequestHandler=>(req,res,next)=>{
  if(req.actor!.role!=='finance'){next(new HttpError(403,'仅财务可录入已付款业绩核定结果'));return;}
  void withTransaction(db, (client) => fn(client, req))
   .then((result) => res.json(result))
   .catch(next);
 };
 router.post('/',mutate(async(c,req)=>{
  const b=req.body??{},key=uuid(b.requestKey),body={businessDate:dateField(b.businessDate,config.businessTimezone),liveRoomCode:textField(b.liveRoomCode,'直播间编号',64),hostName:textField(b.hostName,'主播姓名',128),amountCny:amount(b.amountCny,'财务核定已付款业绩'),note:textField(b.note??'','核定说明',500,false)};
  const hash=hashPayload(body),old=await replay(c,'live_paid_performance',key,hash);if(old)return{id:old.id,replayed:true};
  const row=(await c.query('INSERT INTO live_paid_performance(business_date,live_room_code,host_name,amount_cny,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[body.businessDate,body.liveRoomCode,body.hostName,body.amountCny,body.note,req.actor!.id,key,hash])).rows[0];
  await writeAudit(c,{actorId:req.actor!.id,action:'live_paid_performance_create',entityType:'live_paid_performance',entityId:row.id,after:body,ip:req.ip});return{id:row.id};
 }));
 router.post('/:id/void',mutate(async(c,req)=>{
  const id=uuid(req.params.id),reason=textField(req.body?.reason,'作废原因',500),row=(await c.query('SELECT * FROM live_paid_performance WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new HttpError(404,'核定记录不存在');if(row.voided_at)return{id};
  await c.query('UPDATE live_paid_performance SET voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1',[id,req.actor!.id,reason]);
  await writeAudit(c,{actorId:req.actor!.id,action:'live_paid_performance_void',entityType:'live_paid_performance',entityId:id,before:row,after:{reason},ip:req.ip});return{id};
 }));return router;
}
