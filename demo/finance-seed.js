(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CmsFinanceSeed=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const at=(date,time)=>date+'T'+time+':00.000Z';
  function warehouse(today,shift){
    const yesterday=shift(today,-1);
    return{bills:[
      {id:'demo-wh-bill-1',requestKey:'demo-seed-wh-1',orderId:'demo-order-1',expenseId:'',category:'goods',label:'原石出库 · 手镯料',counterparty:'演示供货方甲',amount:'1280.00',date:yesterday,materialRef:'DEMO-WH-001',proof:'DEMO-WH-P-001',note:'演示数据，仅供体验库房结账流程',status:'submitted',version:1,createdBy:'演示库房',createdAt:at(yesterday,'06:30'),history:[]},
      {id:'demo-wh-bill-2',requestKey:'demo-seed-wh-2',orderId:'demo-order-3',expenseId:'',category:'labor',label:'加工工费 · 雕刻',counterparty:'演示加工坊',amount:'260.00',date:today,materialRef:'DEMO-WH-002',proof:'DEMO-WH-P-002',note:'演示数据，仅供体验库房结账流程',status:'submitted',version:1,createdBy:'演示库房',createdAt:at(today,'02:10'),history:[]}
    ],payments:[]};
  }
  function reimbursements(today,shift){
    const yesterday=shift(today,-1),twoDays=shift(today,-2);
    return{claims:[
      {id:'demo-reim-claim-1',requestKey:'demo-seed-reim-1',claimant:'演示员工甲',department:'演示小组',category:'temporary',purpose:'直播间临时采购包装耗材',amount:'86.00',expenseDate:yesterday,claimDate:today,expenseId:'',receiptRef:'DEMO-REIM-001',note:'演示数据',status:'pending',version:1,createdBy:'演示财务',createdAt:at(today,'03:00'),history:[]},
      {id:'demo-reim-claim-2',requestKey:'demo-seed-reim-2',claimant:'演示员工乙',department:'演示小组',category:'travel',purpose:'外出取货交通费',amount:'150.00',expenseDate:twoDays,claimDate:yesterday,expenseId:'',receiptRef:'DEMO-REIM-002',note:'演示数据',status:'pending',version:1,createdBy:'演示财务',createdAt:at(yesterday,'08:20'),history:[]}
    ],payments:[]};
  }
  return{warehouse,reimbursements};
});
