// gamee-js-stub.js — local dev stub (do NOT include in production zip)
;(function(){
  var _listeners = {};
  function _emit(name){
    (_listeners[name]||[]).forEach(function(fn){
      fn({detail:{callback:function(){console.log('[Gamee stub] callback: '+name);}}});
    });
  }
  window.gamee = {
    gameInit: function(mode, opts, caps, cb){
      console.log('[Gamee stub] gameInit', mode, caps);
      setTimeout(function(){ cb(null, {saveState:null, sound:true}); }, 30);
    },
    gameReady: function(){
      console.log('[Gamee stub] gameReady → start');
      setTimeout(function(){ _emit('start'); }, 80);
    },
    gameStart: function(){ console.log('[Gamee stub] gameStart'); },
    updateScore: function(score, time, cs){ console.log('[Gamee stub] score='+score+' t='+time+' cs='+cs); },
    gameOver: function(replay, save, rewards){ console.log('[Gamee stub] gameOver save='+save); },
    requestPause: function(){ _emit('pause'); },
    emitter: {
      addEventListener: function(event, fn){
        if(!_listeners[event]) _listeners[event]=[];
        _listeners[event].push(fn);
        console.log('[Gamee stub] listener: '+event);
      }
    }
  };
})();
