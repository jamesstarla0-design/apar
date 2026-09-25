(function(root){
  const DEFAULT_TOPIC='kelasrobot/apar/ajang-37ebc682/apar-001/telemetry';
  const DEFAULT_DEVICE='APAR-001';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const bool=v=>typeof v==='boolean';
  function parse(message,deviceId){
    if(typeof message!=='string'||message.length>6000)throw Error('Ukuran pesan tidak valid.');
    const p=JSON.parse(message);
    if(!p||p.schema!==1||p.deviceId!==deviceId)throw Error('ID perangkat atau format pesan berbeda.');
    if(!Number.isInteger(p.seq)||p.seq<0||typeof p.bootId!=='string'||p.bootId.length>40)throw Error('Identitas pesan tidak valid.');
    if(!finite(p.sampleAgeMs)||p.sampleAgeMs<0||p.sampleAgeMs>10000)throw Error('Pembacaan yang diterima sudah terlambat.');
    if(!p.valid||!p.thresholds||!['temperatureC','smokeRaw','currentA'].every(k=>bool(p.valid[k])&&finite(p.thresholds[k])&&p.thresholds[k]>0))throw Error('Validitas sensor atau ambang tidak lengkap.');
    if(!['ready','pressing','returning','cooldown','waiting'].includes(p.servoState)||![0,150].includes(p.servoAngle))throw Error('Status servo tidak valid.');
    if(!Number.isInteger(p.activationCount)||p.activationCount<0||!finite(p.repeatDelayMs)||p.repeatDelayMs<0||!finite(p.remainingMs)||p.remainingMs<0)throw Error('Data siklus tidak valid.');
    for(const k of ['temperatureC','smokeRaw','currentA'])if(p[k]!==null&&!finite(p[k]))throw Error('Nilai sensor tidak valid.');
    p.lastTrigger=typeof p.lastTrigger==='string'?p.lastTrigger.slice(0,70):'';
    return p;
  }
  function valid(p,key){
    if(!p||p.valid[key]!==true||!finite(p[key]))return false;
    const v=p[key];return key==='temperatureC'?v>=-55&&v<=125&&v!==85:key==='smokeRaw'?v>5&&v<4090:v>=0;
  }
  function evaluate(p){
    if(!p)return {state:'waiting',triggers:[],faults:[]};
    const labels={temperatureC:'Suhu',smokeRaw:'Asap / gas',currentA:'Arus listrik'};
    const triggers=[],faults=[];
    for(const k of Object.keys(labels)){if(!valid(p,k))faults.push(labels[k]);else if(p[k]>=p.thresholds[k])triggers.push(labels[k]);}
    return {state:triggers.length?'danger':faults.length?'fault':'normal',triggers,faults};
  }
  const NAMA={temperatureC:'Suhu',smokeRaw:'Asap / gas',currentA:'Arus listrik'};
  const SATUAN={temperatureC:' °C',smokeRaw:' ADC',currentA:' A'};
  const DESIMAL={temperatureC:1,smokeRaw:0,currentA:2};
  const TOKEN={SUHU:'temperatureC',MQ:'smokeRaw',ARUS:'currentA'};
  function angka(v,d){
    return finite(v)?v.toLocaleString('id-ID',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  }
  function describeTrigger(p,cfg){
    if(!p)return null;
    const aktif={temperatureC:!cfg||cfg.enableSuhu!==false,smokeRaw:!cfg||cfg.enableMQ!==false,currentA:!cfg||cfg.enableArus!==false};
    const enabled=Object.keys(NAMA).filter(k=>aktif[k]);
    const fired=[];
    for(const t of String(p.lastTrigger||'').split(/\s+/))if(TOKEN[t])fired.push(TOKEN[t]);
    // Cadangan hanya kalau perangkat tidak mencatat pemicunya. Sensor yang
    // dimatikan pada pengaturan tidak boleh dilaporkan sebagai pemicu.
    if(!fired.length)for(const k of Object.keys(NAMA))if(aktif[k]&&valid(p,k)&&p[k]>=p.thresholds[k])fired.push(k);
    const and=!!cfg&&cfg.logicType===1;
    const min=and?Math.max(1,Math.min(Number(cfg.minTrigger)||1,enabled.length||1)):1;
    return {
      logic:and?'AND':'OR',
      minTrigger:min,
      enabledCount:enabled.length,
      enabled:enabled.map(k=>NAMA[k]),
      mismatch:fired.some(k=>!aktif[k]),
      fired:fired.map(k=>NAMA[k]),
      reasons:fired.map(k=>NAMA[k]+' '+angka(p[k],DESIMAL[k])+SATUAN[k]+' (ambang '+angka(p.thresholds[k],DESIMAL[k])+SATUAN[k]+')'),
      rule:and
        ?'logika AND — minimal '+min+' dari '+enabled.length+' sensor aktif harus melewati ambang'
        :'logika OR — 1 dari '+enabled.length+' sensor aktif yang melewati ambang sudah cukup'
    };
  }
  const K256=new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const rotr=(x,n)=>((x>>>n)|(x<<(32-n)))>>>0;
  function bytes(s){
    const a=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i)&0xff;
    return a;
  }
  function hex(u8){
    let s='';
    for(const b of u8)s+=(b<16?'0':'')+b.toString(16);
    return s;
  }
  // SHA-256 (FIPS 180-4). Padding: 0x80, nol, lalu panjang 64-bit big-endian.
  function sha256(msg){
    const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const len=msg.length;
    const buf=new Uint8Array((((len+8)>>6)+1)<<6);
    buf.set(msg);buf[len]=0x80;
    const dv=new DataView(buf.buffer);
    const bit=len*8;
    dv.setUint32(buf.length-4,bit>>>0);
    dv.setUint32(buf.length-8,Math.floor(bit/4294967296)>>>0);
    const w=new Uint32Array(64);
    for(let off=0;off<buf.length;off+=64){
      for(let i=0;i<16;i++)w[i]=dv.getUint32(off+i*4);
      for(let i=16;i<64;i++){
        const a=w[i-15],b=w[i-2];
        w[i]=(w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(b,17)^rotr(b,19)^(b>>>10)))>>>0;
      }
      let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for(let i=0;i<64;i++){
        const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K256[i]+w[i])>>>0;
        const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
    }
    const out=new Uint8Array(32),odv=new DataView(out.buffer);
    for(let i=0;i<8;i++)odv.setUint32(i*4,H[i]);
    return out;
  }
  // HMAC-SHA256 (RFC 2104).
  function hmacSha256(key,msg){
    let k=key.length>64?sha256(key):key;
    const ipad=new Uint8Array(64),opad=new Uint8Array(64);
    ipad.fill(0x36);opad.fill(0x5c);
    for(let i=0;i<k.length;i++){ipad[i]^=k[i];opad[i]^=k[i];}
    const dalam=new Uint8Array(64+msg.length);
    dalam.set(ipad);dalam.set(msg,64);
    const luar=new Uint8Array(64+32);
    luar.set(opad);luar.set(sha256(dalam),64);
    return sha256(luar);
  }
  // Kunci harus ASCII agar byte-nya sama di JavaScript dan di C++.
  const SEKRET=/^[\x21-\x7e]{8,64}$/;
  const sekretValid=s=>typeof s==='string'&&SEKRET.test(s);
  // String kanonik ini HARUS sama persis dengan configCanonical() di
  // device/config_auth.h. Nilai pecahan dijadikan bilangan bulat supaya tidak
  // ada perbedaan pembulatan float antara JavaScript dan C++.
  function configCanonical(cfg,ts){
    return 'v1|'+String(ts)+'|'+
      (cfg.enableSuhu?1:0)+'|'+(cfg.enableMQ?1:0)+'|'+(cfg.enableArus?1:0)+'|'+
      String(cfg.logicType|0)+'|'+String(cfg.minTrigger|0)+'|'+
      String(Math.round(cfg.thresholdSuhu*10))+'|'+String(cfg.thresholdMQ|0)+'|'+
      String(Math.round(cfg.thresholdArus*100));
  }
  function tandaTangan(cfg,ts,secret){
    return hex(hmacSha256(bytes(secret),bytes(configCanonical(cfg,ts))));
  }
  function signEnvelope(cfg,ts,secret){
    return {v:1,ts:ts,cfg:cfg,sig:tandaTangan(cfg,ts,secret)};
  }
  // Pita aman: lapis kedua supaya satu pesan tidak bisa mematikan deteksi.
  // Ubah bersama BATAS_* di device/config_auth.h.
  const PITA={temperatureC:[40,80],smokeRaw:[800,3000],currentA:[0.2,5]};
  const NAMA_PITA={temperatureC:'Suhu',smokeRaw:'MQ-2',currentA:'Arus'};
  function bandCheck(cfg){
    if(!cfg||typeof cfg!=='object')return {ok:false,masalah:['Isi pengaturan kosong.']};
    const masalah=[];
    const angka={temperatureC:cfg.thresholdSuhu,smokeRaw:cfg.thresholdMQ,currentA:cfg.thresholdArus};
    for(const k of Object.keys(PITA)){
      const v=angka[k],[lo,hi]=PITA[k];
      if(!finite(v)||v<lo||v>hi)masalah.push(NAMA_PITA[k]+' harus antara '+lo+' dan '+hi+'.');
    }
    if(cfg.logicType!==0&&cfg.logicType!==1)masalah.push('Logika harus OR atau AND.');
    if(!Number.isInteger(cfg.minTrigger)||cfg.minTrigger<1||cfg.minTrigger>3)masalah.push('Jumlah minimum harus 1-3.');
    if(!cfg.enableSuhu&&!cfg.enableMQ&&!cfg.enableArus)masalah.push('Minimal satu sensor harus aktif.');
    return {ok:masalah.length===0,masalah};
  }
  function verifyEnvelope(env,secret){
    if(!env||typeof env!=='object')return {ok:false,sebab:'Bentuk pesan tidak dikenali.'};
    if(env.v!==1)return {ok:false,sebab:'Versi protokol tidak didukung.'};
    if(!Number.isInteger(env.ts)||env.ts<0)return {ok:false,sebab:'Penanda waktu tidak valid.'};
    if(typeof env.sig!=='string'||!/^[0-9a-f]{64}$/.test(env.sig))return {ok:false,sebab:'Tanda tangan bukan hex 64 digit.'};
    if(!bandCheck(env.cfg).ok)return {ok:false,sebab:'Isi pengaturan tidak lolos pemeriksaan.'};
    if(!sekretValid(secret))return {ok:false,sebab:'Kunci belum diisi atau tidak sesuai aturan.'};
    if(tandaTangan(env.cfg,env.ts,secret)!==env.sig)return {ok:false,sebab:'Tanda tangan tidak cocok. Kunci di dashboard mungkin berbeda dengan kunci di ESP32.'};
    return {ok:true,cfg:env.cfg,ts:env.ts};
  }
  // Telemetri ditandatangani atas BYTE PERSIS badan JSON, bukan atas string
  // kanonik dari nilai float. Alasannya: pembulatan float bisa berbeda antara
  // JavaScript dan C++, sedangkan byte JSON yang dikirim lewat MQTT sampai utuh
  // apa adanya. Jadi tidak ada nilai yang perlu dihitung ulang — hanya disalin.
  //
  // Perangkat mengirim: {"sig":"<64 hex>",<badan JSON tanpa tanda '{'>
  // Badan itulah yang ditandatangani. Rekonstruksinya deterministik:
  // ambil ulang '{' lalu sisanya apa adanya.
  const AWALAN_SIG=/^\{"sig":"([0-9a-f]{64})",/;
  function pisahTandaTangan(raw){
    if(typeof raw!=='string')return null;
    const m=AWALAN_SIG.exec(raw);
    if(!m)return null;
    return {sig:m[1],badan:'{'+raw.slice(m[0].length)};
  }
  function verifikasiTelemetri(raw,secret){
    const pisah=pisahTandaTangan(raw);
    if(!pisah)return {ada:false,ok:false,sebab:'Pesan telemetri tidak bertanda tangan.'};
    if(!sekretValid(secret))return {ada:true,ok:false,sebab:'Kunci belum diisi, jadi tanda tangan telemetri tidak bisa diperiksa.'};
    if(hex(hmacSha256(bytes(secret),bytes(pisah.badan)))!==pisah.sig)
      return {ada:true,ok:false,sebab:'Tanda tangan telemetri tidak cocok. Kunci di dashboard mungkin berbeda dengan kunci di ESP32.'};
    return {ada:true,ok:true,badan:pisah.badan};
  }
  // Penjaga pesan lama (replay). bootId dibuat acak tiap boot, jadi ia TIDAK
  // bisa dipakai mengurutkan pesan antar-boot: pesan yang direkam penyerang dari
  // boot sebelumnya akan lolos. Karena itu perangkat ikut mengirim "boot" —
  // penghitung menaik yang tersimpan di EEPROM.
  //
  // urut = {boot, seq, bootId} dari pesan terakhir yang diterima, atau null.
  function pesanLebihBaru(p, urut) {
    if (!urut) return true;
    const adaBoot = Number.isInteger(p.boot);
    const urutAdaBoot = Number.isInteger(urut.boot);
    if (adaBoot && urutAdaBoot) {
      if (p.boot !== urut.boot) return p.boot > urut.boot;
      return p.seq > urut.seq;
    }
    // Sudah pernah menerima pesan modern, jadi pesan tanpa "boot" pasti bukan
    // dari perangkat yang sekarang — jangan sampai ini jadi jalan menurunkan
    // versi untuk melewati penjaga.
    if (urutAdaBoot) return false;
    // Perangkat versi lama: yang bisa dilakukan hanya membandingkan dalam boot
    // yang sama. Ini memang lebih lemah, dan memang itu alasan "boot" ditambah.
    return p.bootId !== urut.bootId || p.seq > urut.seq;
  }
  const api={DEFAULT_TOPIC,DEFAULT_DEVICE,parse,valid,evaluate,describeTrigger,
    sha256,hmacSha256,hex,bytes,sekretValid,configCanonical,tandaTangan,signEnvelope,
    bandCheck,verifyEnvelope,PITA,pisahTandaTangan,verifikasiTelemetri,pesanLebihBaru};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AparLogic=api;
})(globalThis);
