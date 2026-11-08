const enc=new TextEncoder();
export const hex = bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(v){return hex(await crypto.subtle.digest('SHA-256',enc.encode(v)))}
export async function passwordHash(password,salt=crypto.randomUUID()){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  return salt+'.'+hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export function fileType(bytes) {
  const a=new Uint8Array(bytes),str=(a,b)=>String.fromCharCode(...new Uint8Array(bytes).slice(a,b));
  if(str(0,5)==='%PDF-') return 'application/pdf';
  if(a[0]===255 && a[1]===216 && a[2]===255) return 'image/jpeg';
  if(hex(a.slice(0,8))==='89504e470d0a1a0a')return 'image/png';
  if(str(0,4)==='RIFF' && str(8,12)==='WEBP')return 'image/webp';
  return null;
}
