(function(){
  var handlers={};
  function fire(ev,a,b,c){(handlers[ev]||[]).slice().forEach(function(f){f(a,b,c);});}
  var client={
    on:function(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);},
    subscribe:function(t,o,cb){if(typeof o==='function'){cb=o;}if(cb)cb(null,[{topic:t,qos:0}]);},
    publish:function(t,p,o,cb){if(cb)cb(null);},
    end:function(){},removeAllListeners:function(){handlers={};}
  };
  window.__picu=fire;
  window.mqtt={connect:function(){setTimeout(function(){fire('connect');},0);return client;}};
})();