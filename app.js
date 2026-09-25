(()=>{
'use strict';
const $=id=>document.getElementById(id), L=window.AparLogic;
const BROKER='wss://broker.emqx.io:8084/mqtt', STALE_MS=12000;
let config={topic:L.DEFAULT_TOPIC,deviceId:L.DEFAULT_DEVICE};
try{const saved=JSON.parse(localStorage.getItem('apar-mqtt-config')||'null');if(saved&&validConfig(saved))config=saved;}catch{}
// Dihitung ulang di connect(), bukan sekali saat dimuat: kalau topik diganti
// lewat dialog Pengaturan, topik config harus ikut pindah.
let configTopic='';
let triggerConfig={enableSuhu:true,enableMQ:true,enableArus:true,logicType:0,minTrigger:1,thresholdSuhu:55,thresholdMQ:2000,thresholdArus:1};
let client=null,connected=false,latest=null,receivedAt=0,subscribed=false,subscribedConfig=false,demo=false,demoOffline=false,issue='',generation=0;
// Urutan pesan terakhir yang diterima, untuk menolak pesan lama yang diputar
// ulang. Disimpan di localStorage per topik+perangkat, bukan hanya di memori:
// kalau hanya di memori, penyerang cukup menunggu pengguna memuat ulang halaman
// lalu mengirim ulang rekamannya.
let urut=null,urutanTertahan=false;
const kunciUrut=()=>'apar-urut:'+config.topic+'|'+config.deviceId;
function muatUrut(){
  urut=null;urutanTertahan=false;
  try{
    const s=JSON.parse(localStorage.getItem(kunciUrut())||'null');
    if(s&&Number.isInteger(s.seq)&&(s.boot===undefined||Number.isInteger(s.boot)))urut=s;
  }catch{}
}
function simpanUrut(p){
  urut={seq:p.seq,bootId:p.bootId};
  if(Number.isInteger(p.boot))urut.boot=p.boot;
  try{localStorage.setItem(kunciUrut(),JSON.stringify(urut));}catch{}
}
// Peringatan servo: satu perintah tekan hanya bertahan ~1 detik di udara, jadi
// kejadiannya diingat di sini supaya tidak terlewat kalau pesan 'pressing' hilang.
const RECENT_MS=20000;
let lastMoveAt=0,lastMove=null,lastCount=-1;
// Kunci bersama untuk menandatangani pesan config. Disimpan di localStorage,
// bukan di berkas yang dipublikasikan.
let secret='';try{secret=localStorage.getItem('apar-config-secret')||'';}catch{}
let deviceConfig=null,deviceConfigAt=0,configIssue='',menungguKonfirmasi=false,menungguSejak=0;
// Status verifikasi telemetri terakhir: '' belum ada data, 'ok' tanda tangan
// cocok, 'warn' diterima tanpa kunci (belum diperiksa), 'bad' ditolak.
let telemetri='',telemetriPesan='',rawTerakhir='';
// Dipakai ulang saat kunci baru diisi: supaya pengguna langsung tahu kuncinya
// cocok atau tidak, tanpa harus menunggu pesan telemetri berikutnya datang.
function periksaUlangTelemetri(){
  if(!rawTerakhir)return;
  const v=L.verifikasiTelemetri(rawTerakhir,secret);
  if(secret&&!v.ok){telemetri='bad';telemetriPesan=v.sebab;return;}
  telemetri=v.ok?'ok':'warn';
  telemetriPesan=v.ok
    ?'Tanda tangan HMAC-SHA256 telemetri cocok dengan kunci di dashboard.'
    :v.ada
      ?'Perangkat mengirim telemetri bertanda tangan, tetapi kunci belum diisi di dashboard — tanda tangannya belum diperiksa.'
      :'Perangkat mengirim telemetri tanpa tanda tangan. Isi MQTT_CONFIG_SECRET di firmware dan kunci yang sama di Pengaturan pemicu agar data bisa diverifikasi.';
}
function renderVerifikasi(){
  const el=$('verifikasi-badge');
  if(demo){el.hidden=true;return;}
  el.hidden=false;
  el.className='verifikasi'+(telemetri?' '+telemetri:'');
  $('verifikasi-icon').setAttribute('href',telemetri==='ok'?'#i-shield':'#i-alert');
  $('verifikasi-text').textContent=telemetri==='ok'?'Telemetri terverifikasi'
    :telemetri==='bad'?'Telemetri ditolak'
    :telemetri==='warn'?'Belum terverifikasi'
    :'Menunggu telemetri';
  el.title=telemetriPesan||'Telemetri belum diperiksa.';
}
function trackServo(p){
  if(!p)return;
  const bergerak=p.servoState==='pressing'||p.servoState==='returning';
  const siklusBaru=lastCount>=0&&p.activationCount>lastCount;
  if(bergerak||siklusBaru){lastMoveAt=Date.now();lastMove=L.describeTrigger(p,triggerConfig);lastMove.state=p.servoState;}
  lastCount=p.activationCount;
}
function validConfig(c){return typeof c.topic==='string'&&/^[A-Za-z0-9_/-]{1,180}$/.test(c.topic)&&!c.topic.startsWith('$')&&/^[A-Za-z0-9_-]{1,40}$/.test(c.deviceId);}
const number=(n,d=0)=>Number.isFinite(n)?n.toLocaleString('id-ID',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const icon=id=>$('status-icon').setAttribute('href','#i-'+id);
function render(){
  const age=receivedAt?Date.now()-receivedAt:Infinity;
  const stale=demo?demoOffline:!connected||!subscribed||age>STALE_MS;
  const state=L.evaluate(latest);
  $('device-name').textContent=config.deviceId;
  $('broker-status').className='connection'+(connected&&!demo?' online':'');
  $('broker-status').lastChild.textContent=demo?'Demo':connected?'Broker terhubung':'Broker terputus';
  let kind=state.state;
  if(stale||!latest)kind='waiting';
  // Preserve a last known emergency in red, but label it explicitly as stale.
  const staleDanger=stale&&latest&&state.state==='danger';
  $('status-banner').className='status-banner '+(staleDanger?'danger':kind);
  if(!latest){icon('wifi');$('status-label').textContent='MENUNGGU DATA';$('status-title').textContent='Perangkat belum terhubung';$('status-detail').textContent=connected?'Broker tersambung. Menunggu pembacaan ESP32 pada topik yang dipilih.':'Dashboard sedang mencoba menyambung ke broker MQTT.';}
  else if(stale){icon(staleDanger?'alert':'wifi');$('status-label').textContent=staleDanger?'DARURAT TERAKHIR · DATA TERPUTUS':'DATA TERPUTUS';$('status-title').textContent=staleDanger?'Status terbaru belum diketahui':'Perangkat tidak memperbarui data';$('status-detail').textContent='Angka di bawah adalah pembacaan terakhir. Periksa koneksi ESP32; kondisi saat ini belum diketahui.';}
  else if(kind==='danger'){icon('alert');$('status-label').textContent='DARURAT';$('status-title').textContent='Kondisi bahaya terdeteksi';$('status-detail').textContent=state.triggers.join(', ')+' melewati ambang. Periksa kondisi perangkat dan area pemantauan.';}
  else if(kind==='fault'){icon('alert');$('status-label').textContent='PERIKSA SENSOR';$('status-title').textContent='Pembacaan sensor tidak valid';$('status-detail').textContent='Periksa '+state.faults.join(', ')+'. Status normal belum dapat dipastikan.';}
  else{icon('shield');$('status-label').textContent='NORMAL';$('status-title').textContent='Semua sensor di bawah ambang';$('status-detail').textContent='Sistem terus memantau suhu, asap, dan arus listrik.';}
  $('trigger-text').textContent=state.triggers.length?'Pemicu: '+state.triggers.join(' · '):state.faults.length?'Tidak valid: '+state.faults.join(' · '):latest?'Tidak ada sensor yang melewati ambang':'Belum ada status sensor';
  $('last-updated').textContent=receivedAt?`Diperbarui ${Math.max(0,Math.floor(age/1000))} detik lalu`:'Belum menerima data';
  for(const [key,id,digits,def]of[['temperatureC','temperature',2,55],['smokeRaw','smoke',0,2000],['currentA','current',3,1]]){
    const v=L.valid(latest,key),over=v&&latest[key]>=latest.thresholds[key];
    $(id+'-value').textContent=v?number(latest[key],digits):'—';
    $(id+'-limit').textContent=number(latest?latest.thresholds[key]:def,key==='currentA'?2:0);
    $(id+'-status').textContent=!latest?'Menunggu':stale?'Data terakhir':!v?'Tidak valid':over?'Tinggi':'Normal';
    $('card-'+id).className='sensor-card'+(over?' high':!v&&latest?' invalid':'')+(stale?' stale':'');
  }
  const names={ready:'Siap',pressing:'Menekan',returning:'Kembali',cooldown:'Jeda ulang',waiting:'Menunggu'};
  const desc={ready:'Siap merespons sensor yang melewati ambang.',pressing:'Perintah tekan pada posisi 150°.',returning:'Perintah kembali ke posisi 0°.',cooldown:'Menunggu jeda sebelum aktivasi ulang.',waiting:'Menunggu pembacaan sensor yang valid.'};
  $('servo-badge').textContent=!latest?'Belum ada data':stale?'Data terakhir':names[latest.servoState];
  $('servo-badge').className='servo-badge'+(!stale&&latest?.servoState==='pressing'?' active':'');
  $('servo-description').textContent=!latest?'Menunggu status perangkat':stale?'Status terakhir, bukan posisi terkini.':desc[latest.servoState];
  $('servo-angle').textContent=latest?latest.servoAngle+'°':'—';
  $('last-trigger').textContent=latest?.lastTrigger||'—';
  $('activation-count').textContent=latest?latest.activationCount+' kali':'—';
  $('repeat-delay').textContent=latest?latest.repeatDelayMs/1000+' detik':'15 detik';
  $('connection-note').textContent=demo?'Tampilan demonstrasi. Tidak mengirim pesan atau menggerakkan servo.':issue||(latest&&!stale?'Menerima data langsung dari ESP32 melalui broker.emqx.io.':connected?'Broker tersambung. Pastikan ESP32 online dan topik MQTT sesuai.':'Mencoba menyambung kembali ke broker.emqx.io.');
  // Tombol ini hanya muncul saat perangkat melaporkan boot yang lebih lama dari
  // yang pernah diterima — jadi kemungkinan EEPROM-nya dihapus atau boardnya
  // diganti. Tidak pernah muncul sendiri karena pemutaran ulang pesan.
  $('urutan-reset').hidden=!(urutanTertahan&&!demo);
  if(menungguKonfirmasi&&Date.now()-menungguSejak>8000){
    menungguKonfirmasi=false;
    if($('trigger-dialog').open)$('trigger-error').textContent='Belum ada konfirmasi dari perangkat. Cek Serial ESP32: kemungkinan kunci berbeda, ambang di luar pita aman, atau penanda waktu tidak lebih baru dari yang tersimpan.';
  }
  if($('trigger-dialog').open)updateSyncStatus();
  renderVerifikasi();
  renderServoAlert(stale);
}
function renderServoAlert(stale){
  const el=$('servo-alert');
  const bergerak=!stale&&latest&&(latest.servoState==='pressing'||latest.servoState==='returning');
  const sisa=latest&&Number.isFinite(latest.remainingMs)?latest.remainingMs:0;
  const dalamJeda=!stale&&sisa>0;
  const usia=lastMoveAt?Date.now()-lastMoveAt:(dalamJeda?Math.max(0,(latest.repeatDelayMs||15000)-sisa):Infinity);
  const baruSaja=!stale&&latest&&usia<RECENT_MS;
  if(!bergerak&&!dalamJeda&&!baruSaja){el.hidden=true;return;}
  el.hidden=false;
  el.className='servo-alert'+(bergerak?' move':' recent');
  $('servo-alert-icon').setAttribute('href',bergerak?'#i-alert':'#i-clock');
  $('servo-alert-label').textContent=bergerak?'SERVO BERGERAK':dalamJeda?'SIKLUS SERVO · JEDA ULANG':'SIKLUS SERVO SELESAI';
  $('servo-alert-title').textContent=bergerak&&latest.servoState==='pressing'?'Servo sedang diperintahkan menekan APAR':
    bergerak?'Servo sedang diperintahkan kembali ke posisi awal':
    'Servo baru saja diperintahkan menekan APAR';
  const info=lastMove||L.describeTrigger(latest,triggerConfig);
  $('servo-alert-detail').textContent=info&&info.reasons.length?'Dipicu oleh '+info.reasons.join(' · ')+'.':'Penyebab pemicu tidak terbaca dari pesan terakhir.';
  $('servo-alert-rule').textContent=info?'Pengaturan pemicu: '+info.rule+'. Sensor aktif: '+(info.enabled.length?info.enabled.join(', '):'tidak ada')+'.'+(info.mismatch?' Perangkat memicu sensor yang dimatikan pada pengaturan dashboard — setelan dashboard mungkin belum tersinkron dengan perangkat.':''):'';
  $('servo-alert-age').textContent=bergerak?'sedang berlangsung':Number.isFinite(usia)&&usia>=0?Math.max(0,Math.floor(usia/1000))+' detik lalu':'';
}
function disconnect(){generation++;if(client){client.removeAllListeners();client.end(true);client=null;}connected=false;subscribed=false;}
function connect(){
  disconnect();const gen=generation;configTopic=config.topic.replace('/telemetry','/config');demo=false;demoOffline=false;$('demo-bar').hidden=true;latest=null;receivedAt=0;issue='';lastMoveAt=0;lastMove=null;lastCount=-1;deviceConfig=null;deviceConfigAt=0;configIssue='';menungguKonfirmasi=false;menungguSejak=0;telemetri='';telemetriPesan='';rawTerakhir='';muatUrut();
  if(!window.mqtt){issue='Library MQTT tidak termuat. Muat ulang halaman atau periksa file mqtt.min.js.';render();return;}
  const bytes=new Uint32Array(2);crypto.getRandomValues(bytes);
  client=window.mqtt.connect(BROKER,{clientId:'apar-web-'+[...bytes].map(v=>v.toString(16)).join(''),clean:true,protocolVersion:4,keepalive:20,connectTimeout:10000,reconnectPeriod:3000,resubscribe:true});
  client.on('connect',()=>{if(gen!==generation)return;connected=true;issue='';
    client.subscribe(config.topic,{qos:0},(err,grants)=>{if(gen!==generation)return;subscribed=!err&&Array.isArray(grants)&&grants.some(g=>g.topic===config.topic&&g.qos!==128);if(!subscribed)issue='Topik MQTT gagal dipantau. Periksa koneksi broker.';render();});
    client.subscribe(configTopic,{qos:0},(err,grants)=>{if(gen!==generation)return;subscribedConfig=!err&&Array.isArray(grants)&&grants.some(g=>g.topic===configTopic&&g.qos!==128);render();});
    client.subscribe(configTopic+'/state',{qos:0},()=>{render();});
    render();
  });
  client.on('message',(topic,payload,packet)=>{
    if(gen!==generation)return;
    if(topic===config.topic&&!packet.retain){
      const raw=payload.toString();
      rawTerakhir=raw;
      // Kalau kunci sudah diisi, telemetri WAJIB bertanda tangan dan cocok —
      // kalau tidak, pesan dibuang supaya angka palsu dari broker publik tidak
      // pernah tampil. Kalau kunci belum diisi, pesan tetap diterima supaya
      // dashboard bisa dipakai, tapi ditandai jelas sebagai belum terverifikasi.
      const verifikasi=L.verifikasiTelemetri(raw,secret);
      if(secret&&!verifikasi.ok){
        telemetri='bad';telemetriPesan=verifikasi.sebab;
        issue='Telemetri DITOLAK: '+verifikasi.sebab+' Pembacaan ini tidak dipakai supaya angka palsu dari broker publik tidak ikut dipercaya.';
        render();return;
      }
      try{
        const p=L.parse(verifikasi.ok?verifikasi.badan:raw,config.deviceId);
        if(!L.pesanLebihBaru(p,urut)){
          // Ada dua kemungkinan: pesan lama yang diputar ulang penyerang, atau
          // perangkat benar-benar mulai dari boot 1 lagi karena EEPROM dihapus
          // atau boardnya diganti. Yang kedua tidak boleh ditolak selamanya,
          // jadi tombol atur ulang ditawarkan — bukan diterima otomatis, supaya
          // pemutaran ulang tidak bisa membuka sendiri jalannya.
          if(Number.isInteger(urut.boot)&&Number.isInteger(p.boot)&&p.boot<urut.boot){
            urutanTertahan=true;
            issue='Pesan dari boot ke-'+p.boot+' diabaikan karena yang terakhir diterima dari boot ke-'+urut.boot+'.';
          }
          render();return;
        }
        simpanUrut(p);latest=p;receivedAt=Date.now()-p.sampleAgeMs;issue='';urutanTertahan=false;
        rawTerakhir=raw;periksaUlangTelemetri();
        trackServo(p);render();
      }catch{issue='Pesan diterima, tetapi format atau ID perangkat tidak sesuai. Gunakan kode ESP32 pendamping.';render();}
    }
    if(topic===configTopic+'/state'){
      // Pesan retained justru yang diinginkan di sini: dashboard yang dibuka
      // belakangan langsung tahu setelan perangkat. Tetap wajib bertanda tangan.
      try{
        const hasil=L.verifyEnvelope(JSON.parse(payload.toString()),secret);
        if(hasil.ok){
          deviceConfig=hasil.cfg;deviceConfigAt=Date.now();configIssue='';
          if(menungguKonfirmasi){
            menungguKonfirmasi=false;
            // Perangkat menerbitkan setelannya setiap kali menerima perubahan,
            // jadi setelan yang berbeda berarti permintaan tadi tidak diterapkan.
            $('trigger-error').textContent=L.configCanonical(hasil.cfg,hasil.ts)===L.configCanonical(triggerConfig,hasil.ts)
              ?'Perangkat sudah menerapkan setelan ini.'
              :'Perangkat melaporkan setelan yang BERBEDA dari yang baru dikirim, jadi kemungkinan permintaan tadi ditolak. Cek Serial ESP32 untuk alasannya.';
          }
          // Jangan timpa isian yang sedang diedit; cukup perbarui baris statusnya.
          if($('trigger-dialog').open)updateSyncStatus();else populateTriggerDialog();
        }else{
          configIssue=hasil.sebab;
        }
        render();
      }catch{configIssue='Kondisi config perangkat tidak bisa dibaca.';render();}
    }
  });
  client.on('close',()=>{if(gen!==generation)return;connected=false;subscribed=false;subscribedConfig=false;render();});
  client.on('error',()=>{if(gen!==generation)return;issue='Koneksi MQTT bermasalah. Dashboard akan mencoba menyambung kembali.';render();});
  render();
}
function demoData(danger=false){return{schema:1,deviceId:config.deviceId,bootId:'demo',seq:1,sampleAgeMs:0,temperatureC:danger?58.4:29.81,smokeRaw:danger?2230:822,currentA:danger?1.3:.106,valid:{temperatureC:true,smokeRaw:true,currentA:true},thresholds:{temperatureC:55,smokeRaw:2000,currentA:1},servoState:danger?'pressing':'ready',servoAngle:danger?150:0,lastTrigger:danger?'SUHU · MQ · ARUS':'',activationCount:danger?1:0,repeatDelayMs:15000,remainingMs:0};}
function showDemo(danger=false){disconnect();demo=true;demoOffline=false;lastMoveAt=0;lastMove=null;lastCount=-1;latest=demoData(danger);receivedAt=Date.now();trackServo(latest);$('demo-bar').hidden=false;render();}
$('settings').onclick=()=>{$('topic-input').value=config.topic;$('device-input').value=config.deviceId;$('form-error').textContent='';$('settings-dialog').showModal();};
$('close-settings').onclick=()=>$('settings-dialog').close();
$('settings-form').onsubmit=e=>{e.preventDefault();const c={topic:$('topic-input').value.trim(),deviceId:$('device-input').value.trim()};if(!validConfig(c)){$('form-error').textContent='Topik: gunakan huruf, angka, /, _ atau -. ID perangkat tanpa /.';return;}config=c;try{localStorage.setItem('apar-mqtt-config',JSON.stringify(config));}catch{}$('settings-dialog').close();connect();};
$('preview-demo').onclick=()=>{$('settings-dialog').close();showDemo();};
$('demo-normal').onclick=()=>showDemo(false);$('demo-danger').onclick=()=>showDemo(true);
$('demo-offline').onclick=()=>{demoOffline=true;receivedAt=Date.now()-20000;render();};
$('demo-exit').onclick=connect;
// Hanya bisa ditekan setelah dashboard benar-benar melihat boot yang lebih lama,
// jadi penyerang tidak bisa memicunya dari jauh dengan mengirim satu pesan.
$('urutan-reset').onclick=()=>{
  try{localStorage.removeItem(kunciUrut());}catch{}
  urut=null;urutanTertahan=false;issue='Urutan pesan diatur ulang. Menunggu pesan berikutnya dari perangkat.';
  render();
};
window.addEventListener('online',()=>{if(!demo&&!connected)connect();});
setInterval(()=>{if(demo&&!demoOffline)receivedAt=Date.now();render();},1000);

function updateSyncStatus(){
  const el=$('sync-status');
  el.textContent=configIssue?'Kondisi perangkat: '+configIssue
    :deviceConfig?'Kondisi perangkat sah dan diterima '+Math.max(0,Math.floor((Date.now()-deviceConfigAt)/1000))+' detik lalu. Tanda tangan cocok dengan kunci ini.'
    :!secret?'Kunci config belum diisi, jadi kondisi perangkat tidak bisa diverifikasi.'
    :'Belum ada kondisi perangkat yang diterima. Nilai di bawah berasal dari dashboard, belum tentu sama dengan ESP32.';
  el.className='sync-status'+(configIssue?' bad':deviceConfig?' ok':'');
}
function populateTriggerDialog(){
  // Kalau perangkat sudah melaporkan setelannya dan tanda tangannya sah, itu
  // yang ditampilkan — bukan tebakan dari dashboard.
  const sumber=deviceConfig||triggerConfig;
  $('enable-suhu').checked=sumber.enableSuhu!==false;
  $('enable-mq').checked=sumber.enableMQ!==false;
  $('enable-arus').checked=sumber.enableArus!==false;
  const logicRadios=document.querySelectorAll('input[name="logic"]');
  for(const r of logicRadios)r.checked=(sumber.logicType===(r.value==='and'?1:0));
  const minRadios=document.querySelectorAll('input[name="min"]');
  for(const r of minRadios)r.checked=(sumber.minTrigger===parseInt(r.value));
  $('threshold-suhu').value=sumber.thresholdSuhu||55;
  $('threshold-mq').value=sumber.thresholdMQ||2000;
  $('threshold-arus').value=sumber.thresholdArus||1;
  $('config-secret').value=secret;
  updateSyncStatus();
}
function sendTriggerConfig(cfg){
  if(!client||!connected){$('trigger-error').textContent='Broker tidak terhubung.';return;}
  if(!L.sekretValid(secret)){$('trigger-error').textContent='Isi kunci config dulu: 8-64 karakter ASCII tanpa spasi, sama dengan MQTT_CONFIG_SECRET di firmware.';return;}
  $('trigger-error').textContent='';
  const env=L.signEnvelope(cfg,Date.now(),secret);
  menungguKonfirmasi=true;menungguSejak=Date.now();
  client.publish(configTopic,JSON.stringify(env),{qos:0},(err)=>{
    if(err){menungguKonfirmasi=false;$('trigger-error').textContent='Gagal mengirim config.';}
    else $('trigger-error').textContent='Terkirim dan bertanda tangan. Menunggu konfirmasi dari perangkat…';
  });
}
$('trigger-settings').onclick=()=>{populateTriggerDialog();$('trigger-error').textContent='';$('trigger-dialog').showModal();};
$('close-trigger').onclick=()=>$('trigger-dialog').close();
$('reset-trigger').onclick=()=>{
  triggerConfig={enableSuhu:true,enableMQ:true,enableArus:true,logicType:0,minTrigger:1,thresholdSuhu:55,thresholdMQ:2000,thresholdArus:1};
  sendTriggerConfig(triggerConfig);
};
$('trigger-form').onsubmit=e=>{
  e.preventDefault();
  const kunci=$('config-secret').value.trim();
  if(!L.sekretValid(kunci)){$('trigger-error').textContent='Kunci config harus 8-64 karakter ASCII tanpa spasi, dan sama dengan MQTT_CONFIG_SECRET di firmware.';return;}
  const suhu=Math.round(parseFloat($('threshold-suhu').value)*10)/10;
  const mq=parseInt($('threshold-mq').value,10);
  const arus=Math.round(parseFloat($('threshold-arus').value)*100)/100;
  if(!Number.isFinite(suhu)||!Number.isInteger(mq)||!Number.isFinite(arus)){$('trigger-error').textContent='Isi semua ambang dengan angka.';return;}
  const newCfg={
    enableSuhu:$('enable-suhu').checked,
    enableMQ:$('enable-mq').checked,
    enableArus:$('enable-arus').checked,
    logicType:document.querySelector('input[name="logic"]:checked').value==='and'?1:0,
    minTrigger:parseInt(document.querySelector('input[name="min"]:checked').value,10),
    thresholdSuhu:suhu,
    thresholdMQ:mq,
    thresholdArus:arus
  };
  // Pita aman ini harus sama dengan BATAS_* di device/config_auth.h.
  const pita=L.bandCheck(newCfg);
  if(!pita.ok){$('trigger-error').textContent=pita.masalah.join(' ')+' Batas ini ada supaya satu pesan tidak bisa mematikan deteksi.';return;}
  secret=kunci;
  try{localStorage.setItem('apar-config-secret',secret);}catch{}
  // Kunci ini juga yang memverifikasi telemetri, jadi pesan terakhir diperiksa
  // ulang sekarang — pengguna langsung tahu kuncinya cocok atau tidak.
  periksaUlangTelemetri();
  triggerConfig=newCfg;
  sendTriggerConfig(newCfg);
};

connect();
})();
