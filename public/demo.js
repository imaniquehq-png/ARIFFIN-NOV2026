import {applyNewEvents,materialize} from './events.mjs';
export const demoUser={id:'latihan',name:'Pengurus Contoh',email:'contoh@latihan.invalid',role:'management'};
export function demoWorkspace(){
  const files={'gambar-contoh':{id:'gambar-contoh',name:'Emas contoh.jpg',type:'image/jpeg',size:92000},'dokumen-contoh':{id:'dokumen-contoh',name:'Dokumen latihan.pdf',type:'application/pdf',size:600}};
  const events=[],photo='gambar-contoh',file='dokumen-contoh';
  const day=offset=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10);
  let date=day(-7);
  function add(action,data,prefix){
    const now=date+'T02:30:00.000Z';
    const actor=['purchase.confirm','request.close'].includes(action)?{id:'latihan-akaun',name:'Akauntan Contoh',role:'accountant'}:demoUser;
    const [e]=applyNewEvents(events,[{action,data}],actor,files,now);events.push(e);
    return prefix+'-'+String(e.seq).padStart(6,'0');
  }
  const suppliers=[['Pembekal Contoh A','DEMO-A','WeBuy'],['Pembekal Contoh B','DEMO-B','Tahil'],['Pembekal Contoh C','DEMO-C','Tahil']];
  const partners=suppliers.map(([name,code,method])=>add('agent.create',{name,code,method,bank:'Bank Contoh',account:'CONTOH-'+code,gramsPerTael:37.5},'AG'));
  const refinery=add('refinery.create',{name:'Kilang Emas Contoh',code:'KCE',gramsPerTael:37.5,advancePercent:90},'KLG');
  [52.4,78.65,45.03,92.2,63.5,74.8,35.6,42.45,18.2].forEach((weight,i)=>{
    date=day(-6+Math.min(i,6));const a=i%3,agentId=partners[a],requested=40000;
    const r=add('request.create',{date,agentId,requested,purpose:'Pembelian emas daripada pembekal'},'PRQ');
    add('request.approve',{requestId:r,approved:requested});
    add('request.transfer',{requestId:r,date,amount:requested,bankRef:'DEMO-TR-'+i,proof:file});
    const lot=add('purchase.create',{requestId:r,date,owner:suppliers[a][0],type:'Emas terpakai',purity:916,weight,price:a===0?415:15562.5,photo,...(i<7?{invoiceNo:'CONTOH-BEL-'+i,invoiceFile:file}:{})},'LOT');
    if(i<6){
      add('purchase.confirm',{purchaseId:lot,date});
      const unused=(4000000-Math.round(weight*415*100))/100;
      if(unused>0)add('request.return',{requestId:r,date,amount:unused,bankRef:'DEMO-RTN-'+i,proof:file});
    }
    if(i<6)add('mks.lock',{lotId:lot,number:'CONTOH-MKS-'+i,dateTime:date+'T11:00',price:418,weight});
    if(i<8){
      add('process.save',{lotId:lot,date,mode:'skip',operator:'Staf Contoh'});
      const d=add('delivery.create',{date,lotIds:[lot],photo},'DLV');
      add('delivery.issue',{deliveryId:d,file,basis:materialize(events,files).deliveries.find(item=>item.id===d).formBasis});
      add('delivery.receive',{deliveryId:d,receivedDate:date,receivedWeights:{[lot]:weight},note:''});
    }
    if([0,2,4].includes(i)){
      const shipment=add('dispatch.create',{date,refineryId:refinery,lotIds:[lot],photo,document:file},'DO');
      add('dispatch.pr',{dispatchId:shipment,prNo:'CONTOH-PR-'+i,prDate:date});
      if(i===0)add('assay.create',{dispatchId:shipment,lotId:lot,date,reportNo:'CONTOH-AS-01',before:weight,after:weight-.1,purity:920,file});
      const sale=add('sale.create',{shipmentId:shipment,date,weight,price:16500},'INV');
      if(i===0)add('sale.finalize',{saleId:sale,date,adjustment:0,directCost:80,note:'Harga dan assay contoh disahkan.'});
      add('sale.receive',{saleId:sale,date,amount:Math.round(weight*440*.9*100)/100,bankRef:'CONTOH-RC-'+i,proof:file});
    }
  });
  add('request.create',{date,agentId:partners[0],requested:24000,purpose:'Belian seterusnya'},'PRQ');
  return {events,files,state:materialize(events,files)};
}

