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
    var simpan=null;
    try{simpan=localStorage.getItem('apar-urut:'+TOPIK+'|APAR-001');}catch(e){}
    cek('halaman dimuat ulang masih menyimpan urutan', !!simpan, String(simpan));

    // Hanya rekaman lama yang dikirim: perangkat sedang dibisukan penyerang.
    kirim(REKAMAN);
    return tunggu(60);
  }).then(function(){
    cek('replay ditolak walau halaman baru dimuat ulang',
      suhu().indexOf('25,00')<0, 'tampil=' + suhu());
    cek('dashboard jujur bilang belum ada data, bukan menampilkan normal palsu',
      !/Semua sensor di bawah ambang/.test(judul()), 'judul=' + judul());
    tampilkan(hasil);
  }).catch(function(e){tampilkan(['GAGAL fatal: '+(e&&e.stack||e)]);});
})();