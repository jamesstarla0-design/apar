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
    kirim(badan(29.81,'cccc3333-dddd4444',10,2));
    return tunggu(40);
  }).then(function(){
    cek('1. pesan sah diterima', suhu().indexOf('29,81')===0, suhu());

    // Perangkat yang EEPROM-nya dihapus akan melaporkan boot 1 lagi.
    kirim(badan(31.50,'eeee5555-ffff6666',1,1));
    return tunggu(40);
  }).then(function(){
    cek('2. boot lebih lama tidak diterima otomatis', suhu().indexOf('29,81')===0, suhu());
    cek('3. tombol atur ulang muncul', document.getElementById('urutan-reset').hidden===false);

    document.getElementById('urutan-reset').click();
    return tunggu(20);
  }).then(function(){
    cek('4. tombol menyembunyikan dirinya', document.getElementById('urutan-reset').hidden===true);
    kirim(badan(31.50,'eeee5555-ffff6666',1,1));
    return tunggu(40);
  }).then(function(){
    cek('5. setelah atur ulang, pesan perangkat diterima', suhu().indexOf('31,50')===0, suhu());
    tampilkan(hasil);
  }).catch(function(e){tampilkan(['GAGAL fatal: '+(e&&e.stack||e)]);});
})();