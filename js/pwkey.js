/* ============ Password-derived account key (same as the Android app) ============
   The app builds the account key from username + password + salt, so any
   device that knows the password gets the very same key — that's what lets
   the phone and this browser read the same chats. Must match
   KalisiCrypto.keyPairFromPassword / verifierFor in kalisi-native exactly. */
const P256={
  p:0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
  a:0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
  n:0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  gx:0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  gy:0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
};
const _mod=(a,m)=>((a%m)+m)%m;
function _inv(a,m){ let [r0,r1,s0,s1]=[_mod(a,m),m,1n,0n];
  while(r1){ const q=r0/r1; [r0,r1]=[r1,r0-q*r1]; [s0,s1]=[s1,s0-q*s1]; } return _mod(s0,m); }
function _add(P,Q){
  const p=P256.p; if(!P)return Q; if(!Q)return P;
  if(P[0]===Q[0]){ if(_mod(P[1]+Q[1],p)===0n)return null;
    const l=_mod((3n*P[0]*P[0]+P256.a)*_inv(2n*P[1],p),p);
    const x=_mod(l*l-2n*P[0],p); return [x,_mod(l*(P[0]-x)-P[1],p)]; }
  const l=_mod((Q[1]-P[1])*_inv(Q[0]-P[0],p),p);
  const x=_mod(l*l-P[0]-Q[0],p); return [x,_mod(l*(P[0]-x)-P[1],p)];
}
function _mul(k){ let R=null,A=[P256.gx,P256.gy]; while(k>0n){ if(k&1n)R=_add(R,A); A=_add(A,A); k>>=1n; } return R; }
const _hex32=v=>v.toString(16).padStart(64,'0');
const _b64u=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const _hexBytes=h=>Uint8Array.from(h.match(/../g),x=>parseInt(x,16));

async function _stretch(text,saltB64,iterations){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(text),'PBKDF2',false,['deriveBits']);
  const salt=Uint8Array.from(atob(saltB64),c=>c.charCodeAt(0));
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},km,256));
}
/* → {pub, priv} as JWK objects, ready for WebCrypto ECDH */
async function keyFromPassword(username,password,saltB64){
  const seed=await _stretch('kalisi:'+username+':'+password,saltB64,120000);
  let d=BigInt('0x'+[...seed].map(b=>b.toString(16).padStart(2,'0')).join(''));
  d=d%(P256.n-1n)+1n;
  const [x,y]=_mul(d);
  const pub={kty:'EC',crv:'P-256',x:_b64u(_hexBytes(_hex32(x))),y:_b64u(_hexBytes(_hex32(y)))};
  return {pub, priv:{...pub,d:_b64u(_hexBytes(_hex32(d)))}};
}
/* what the server keeps to check a password-recovery login */
async function verifierFor(username,password,saltB64){
  const v=await _stretch('kalisi-verify:'+username+':'+password,saltB64,60000);
  return btoa(String.fromCharCode(...v));
}
function newSalt(){ return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))); }
if(typeof module!=='undefined')module.exports={keyFromPassword,verifierFor};
