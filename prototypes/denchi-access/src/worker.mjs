
const textEncoder = new TextEncoder();
const cookieName = "__Host-denchi_session";
const sessionSeconds = 7200;
const privateObject = "seminar/2026-11-08/theme-01.pdf";
const security = {
  "Cache-Control":"no-store, private",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "X-Frame-Options":"DENY",
  "Cross-Origin-Resource-Policy":"same-origin",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=()"
};
function htmlPage(error=false) {
  const msg=error?"<p role='alert'>合言葉が違います。</p>":"";
  const page="<!doctype html><html lang='ja'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>11月8日セミナー｜資料閲覧</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#edf5ee;color:#20382e;margin:0}main{max-width:420px;margin:6vh auto;background:white;border-radius:16px;padding:25px}label{display:block}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%}button{margin-top:15px;background:#267254;color:#fff;border:0;border-radius:9px}</style></head><body><main><h1>11月8日セミナー資料</h1><p>参加者は共通の合言葉で資料を閲覧できます。会員登録は不要です。</p>"+msg+"<form action='/login' method='POST'><label for='passcode'>合言葉</label><input id='passcode' type='password' name='passcode' autocomplete='off' maxlength='128' required><button>資料を開く</button></form><p>無料アプリ「こどものでんち」は従来どおり公開を継続します。</p></main></body></html>";
  return new Response(page,{status:error?401:200,headers:{...security,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
function deny(){return new Response("Forbidden",{status:403,headers:security});}
function hex(buffer){return Array.from(new Uint8Array(buffer)).map(v=>v.toString(16).padStart(2,"0")).join("");}
function unhex(s){return /^[a-f0-9]{64}$/.test(s)?Uint8Array.from(s.match(/../g),x=>parseInt(x,16)):null;}
async function key(secret){return crypto.subtle.importKey("raw",textEncoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
async function equalSecret(a,b){
  const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",textEncoder.encode(a)),crypto.subtle.digest("SHA-256",textEncoder.encode(b))]);
  const aa=new Uint8Array(x),bb=new Uint8Array(y);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
async function issue(env){
  const payload=String(Math.floor(Date.now()/1000)+sessionSeconds)+"."+crypto.randomUUID();
  const signature=hex(await crypto.subtle.sign("HMAC",await key(env.SESSION_SIGNING_KEY),textEncoder.encode(payload)));
  return payload+"."+signature;
}
async function authorized(request,env){
  const token=(request.headers.get("Cookie")||"").split(";").map(v=>v.trim()).find(v=>v.startsWith(cookieName+"="))?.slice(cookieName.length+1);
  if(!token||token.length>200)return false;
  const parts=token.split(".");
  if(parts.length!==3||!/^[0-9]{10}$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1]))return false;
  const now=Math.floor(Date.now()/1000),expires=Number(parts[0]);
  if(expires<=now||expires>now+sessionSeconds)return false;
  const bytes=unhex(parts[2]);if(!bytes)return false;
  return crypto.subtle.verify("HMAC",await key(env.SESSION_SIGNING_KEY),bytes,textEncoder.encode(parts[0]+"."+parts[1]));
}
function sameOrigin(req){const origin=req.headers.get("Origin");return !!origin&&origin===new URL(req.url).origin;}
function redirect(path,setCookie){
  return new Response(null,{status:303,headers:{...security,Location:path,...(setCookie?{"Set-Cookie":setCookie}:{})}});
}
export default {
  async fetch(req,env){
    // Fail closed: all resources must exist and secrets must be strong.
    if(!env||typeof env.SEMINAR_PASSCODE!=="string"||env.SEMINAR_PASSCODE.length<20||
       typeof env.SESSION_SIGNING_KEY!=="string"||env.SESSION_SIGNING_KEY.length<32||
       !env.PRIVATE_MATERIALS?.get||!env.LOGIN_LIMITER?.limit)
      return new Response("Service unavailable",{status:503,headers:security});
    const u=new URL(req.url);
    if(u.search||!["/","/login","/material","/logout"].includes(u.pathname))
      return new Response("Not found",{status:404,headers:security});
    if(u.pathname==="/"&&req.method==="GET")return htmlPage();
    if(u.pathname==="/login"&&req.method==="POST"){
      if(!sameOrigin(req)||req.headers.get("Content-Type")?.split(";")[0].toLowerCase()!=="application/x-www-form-urlencoded")return deny();
      let attempt;
      try{attempt=await env.LOGIN_LIMITER.limit({key:req.headers.get("CF-Connecting-IP")||"unknown"});}
      catch{return new Response("Service unavailable",{status:503,headers:security});}
      if(!attempt?.success)return new Response("Too many attempts",{status:429,headers:{...security,"Retry-After":"60"}});
      // Reject oversized payloads without buffering the full request.
      const contentLength=req.headers.get("Content-Length");
      if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>1024))return deny();
      const reader=req.body?.getReader();if(!reader)return deny();
      const chunks=[];let total=0;
      while(true){
        const part=await reader.read();if(part.done)break;
        total+=part.value.byteLength;
        if(total>1024){await reader.cancel();return deny();}
        chunks.push(part.value);
      }
      const combined=new Uint8Array(total);let offset=0;
      for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
      let payload;
      try{payload=new TextDecoder("utf-8",{fatal:true}).decode(combined);}
      catch{return deny();}
      const passcode=new URLSearchParams(payload).get("passcode")||"";
      if(passcode.length>128||!(await equalSecret(passcode,env.SEMINAR_PASSCODE)))return htmlPage(true);
      const session=await issue(env);
      return redirect("/material",cookieName+"="+session+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+sessionSeconds);
    }
    if(u.pathname==="/material"&&req.method==="GET"){
      if(!(await authorized(req,env)))return deny();
      let obj;
      try{obj=await env.PRIVATE_MATERIALS.get(privateObject);}
      catch{return new Response("Service unavailable",{status:503,headers:security});}
      if(!obj)return new Response("Material not configured",{status:404,headers:security});
      return new Response(obj.body,{headers:{...security,"Content-Type":"application/pdf","Content-Disposition":'inline; filename="seminar-theme-01.pdf"',"Vary":"Cookie"}});
    }
    if(u.pathname==="/logout"&&req.method==="POST"){
      if(!sameOrigin(req))return deny();
      return redirect("/",cookieName+"=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
    }
    return new Response("Method not allowed",{status:405,headers:{...security,Allow:"GET, POST"}});
  }
};
