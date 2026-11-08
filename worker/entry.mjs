// The build supplies the api handler and exact-path asset dictionary above this entry.
export default {
  async fetch(request,env) {
    const rawPath = new URL(request.url).pathname;
    if(rawPath.startsWith('/api/')) return api(request,env);
    if(!['GET','HEAD'].includes(request.method))
      return new Response('Kaedah tidak disokong.',{status:405,headers:{Allow:'GET, HEAD'}});
    let route;
    try { route=decodeURIComponent(rawPath); }
    catch { return new Response('Laluan tidak sah.',{status:400}); }
    if(route==='/')route='/index.html';
    if(!Object.hasOwn(staticAssets,route))return new Response('Tidak dijumpai.',{status:404});
    const asset=staticAssets[route];
    const headers={'Content-Type':asset.type,ETag:asset.etag,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'};
    if(request.headers.get('if-none-match')===asset.etag)return new Response(null,{status:304,headers});
    if(request.method==='HEAD')return new Response(null,{headers});
    const body=asset.text ? asset.body : Uint8Array.from(atob(asset.body),char=>char.charCodeAt(0));
    return new Response(body,{headers});
  }
};
