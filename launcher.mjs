import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const port=Number(process.env.AJ_PORT || 4317);
if(!Number.isInteger(port) || port < 1 || port > 65535)throw new Error('Nombor port tidak sah.');
const origin='http://127.0.0.1:'+port;
const server=fileURLToPath(new URL('./server.mjs',import.meta.url));
async function ready() {
  try {
    const res=await fetch(origin+'/api/session',{signal:AbortSignal.timeout(1200),redirect:'error'});
    const session=res.ok && res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
    if(!session?.local || !Object.hasOwn(session,'user') || typeof session.setup!=='boolean')return false;
    const page=await fetch(origin,{signal:AbortSignal.timeout(1200),redirect:'error'});
    return page.ok && (await page.text()).includes('<title>Ariffin Jewels');
  }catch{return false;}
}
function openBrowser() {
  console.log('Buka '+origin+' dalam pelayar.');
  if(process.argv.includes('--no-browser'))return;
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{detached:true,windowsHide:true,stdio:'ignore'});
  child.on('error',()=>console.log('Buka alamat di atas secara manual.'));
  child.unref();
}
if(await ready()){
  openBrowser();
}else{
  const child=spawn(process.execPath,[server],{stdio:'inherit',windowsHide:true,env:{...process.env,AJ_PORT:String(port),AJ_HOST:'127.0.0.1'}});
  let exited=false;
  const stopped=new Promise(resolve=>{
    child.once('error',error=>{console.error(error.message);exited=true;resolve(1);});
    child.once('exit',code=>{exited=true;resolve(code ?? 0);});
  });
  const stop=()=>{if(!exited)child.kill();};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  let accessible=false;
  for(let i=0;i<40 && !exited;i++){
    if(await ready()){accessible=true;break;}
    await delay(250);
  }
  if(accessible){
    openBrowser();
    console.log('Biarkan tetingkap ini terbuka. Tekan Ctrl+C untuk menghentikan pelayan.');
    process.exitCode=await stopped;
  }else{
    stop();
    await stopped;
    console.error('Pelayan belum sedia. Semak ralat di atas dan pastikan port '+port+' tersedia.');
    process.exitCode=1;
  }
}
