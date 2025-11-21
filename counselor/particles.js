z// Lightweight particle background for a container
(function(global){
  function initParticles(containerId, opts){
    opts = Object.assign({count: 28, colorA:'#7b2ff7', colorB:'#0ea5e9', sizeMin:3, sizeMax:10, speed:0.3}, opts||{});
    const container = document.getElementById(containerId);
    if(!container) return null;
    container.style.position = container.style.position || 'relative';

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.left = 0; canvas.style.top = 0; canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.style.zIndex = 0; canvas.style.pointerEvents = 'none';
    canvas.className = 'particle-canvas';
    container.insertBefore(canvas, container.firstChild);
    const ctx = canvas.getContext('2d');

    let W, H, raf;
    function resize(){
      W = canvas.width = container.clientWidth;
      H = canvas.height = container.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // particle model
    const parts = [];
    for(let i=0;i<opts.count;i++){
      parts.push({
        x: Math.random()*W,
        y: Math.random()*H,
        r: opts.sizeMin + Math.random()*(opts.sizeMax-opts.sizeMin),
        dx: (Math.random()-0.5)*opts.speed,
        dy: - (0.1 + Math.random()*opts.speed),
        hue: Math.random()
      });
    }

    function draw(){
      ctx.clearRect(0,0,W,H);
      parts.forEach(p=>{
        // simple oscillation for cinematic movement
        p.x += p.dx + Math.sin((Date.now()/500)+p.hue*10)*0.15;
        p.y += p.dy + Math.cos((Date.now()/700)+p.hue*8)*0.08;
        if(p.y < -20) { p.y = H + 20; p.x = Math.random()*W; }
        if(p.x < -40) p.x = W + 40; if(p.x > W + 40) p.x = -40;

        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3);
        g.addColorStop(0, `rgba(255,255,255,0.6)`);
        g.addColorStop(0.2, hexToRgba(opts.colorA,0.16));
        g.addColorStop(1, hexToRgba(opts.colorB,0.03));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    function destroy(){ cancelAnimationFrame(raf); window.removeEventListener('resize', resize); try{ canvas.remove(); }catch(e){} }
    return { destroy };
  }

  function hexToRgba(hex, a){
    if(!hex) return `rgba(0,0,0,${a||1})`;
    const h = hex.replace('#','');
    const bigint = parseInt(h.length===3? h.split('').map(c=>c+c).join('') : h,16);
    const r = (bigint>>16)&255; const g = (bigint>>8)&255; const b = bigint&255;
    return `rgba(${r},${g},${b},${a||1})`;
  }

  // expose
  global.ParticleBG = { init: initParticles };
})(window);
