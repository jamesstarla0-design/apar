(function(){
  var hasil=[];
  function cek(n,s,d){hasil.push((s?'OK   ':'GAGAL ')+n+(d?'  -> '+d:''));}
  function tunggu(ms){return new Promise(function(r){setTimeout(r,ms);});}

  var L=window.AparLogic, KUNCI='KunciUji12345', TOPIK='apar/uji/telemetry';
  function badan(suhu,bootId,seq,boot){
    var o={schema:1,deviceId:'APAR-001',bootId:bootId,seq:seq,sampleAgeMs:100,
      temperatureC:suhu,smokeRaw:822,currentA:0.106,
      valid:{temperatureC:true,smokeRaw:true,currentA:true},
      thresholds:{temperatureC:55,smokeRaw:2000,currentA:1},
      servoState:'ready',servoAngle:0,lastTrigger:'',activationCount:0,
      repeatDelayMs:15000,remainingMs:0};
    if(boot!==undefined)o.boot=boot;
    return JSON.stringify(o);
  }
  function tandai(b){return '{"sig":"'+L.hex(L.hmacSha256(L.bytes(KUNCI),L.bytes(b)))+'",'+b.slice(1);}
  function kirim(b){window.__picu('message',TOPIK,tandai(b),{retain:false});}
  function suhu(){return (document.getElementById('temperature-value').textContent||'').trim();}
  function judul(){return (document.getElementById('status-title').textContent||'').trim();}
  function tampilkan(hasil){
    var el=document.createElement('pre');el.id='hasil-uji';
    el.textContent=hasil.join('\n');document.body.appendChild(el);
  }
  var REKAMAN = badan(25.00,'aaaa1111-bbbb2222',99,1);   // direkam saat boot 1

  tunggu(80).then(function(){
    kirim(badan(29.81,'cccc3333-dddd4444',10,2));   // perangkat sekarang boot 2
    return tunggu(40);
  }).then(function(){
    cek('1. pesan sah diterima', suhu().indexOf('29,81')===0, suhu());

    kirim(badan(25.00,'cccc3333-dddd4444',5,2));    // replay boot sama, seq lama
    return tunggu(40);
  }).then(function(){
    cek('2. replay boot sama + seq lama DITOLAK', suhu().indexOf('29,81')===0, suhu());

    kirim(REKAMAN);                                  // replay dari boot sebelumnya
    return tunggu(40);
  }).then(function(){
    cek('3. replay dari boot SEBELUMNYA DITOLAK', suhu().indexOf('29,81')===0, 'tampil=' + suhu());

    kirim(badan(29.81,'cccc3333-dddd4444',10,2));    // replay pesan terakhir
    return tunggu(40);
  }).then(function(){
    cek('4. replay pesan terakhir DITOLAK', suhu().indexOf('29,81')===0, suhu());

    for(var i=0;i<15;i++)kirim(REKAMAN);             // serangan masking berulang
    return tunggu(80);
  }).then(function(){
    // Catatan: judul status TIDAK bisa dipakai sebagai penanda di sini, karena
    // 29,81 (sah) dan 25,00 (rekaman) sama-sama di bawah ambang 55 — judulnya
    // memang "normal" untuk keduanya. Yang membedakan hanya angkanya.
    cek('5. masking berulang tidak menimpa angka sah', suhu().indexOf('29,81')===0, suhu());

    var simpan=null;
    try{simpan=localStorage.getItem('apar-urut:'+TOPIK+'|APAR-001');}catch(e){}
    cek('6. urutan tersimpan di localStorage', !!simpan && /"boot":2/.test(simpan), String(simpan));
    tampilkan(hasil);
  }).catch(function(e){tampilkan(['GAGAL fatal: '+(e&&e.stack||e)]);});
})();