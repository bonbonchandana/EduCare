(function(){
  // Small JS to seed occasional electric sparks around elements with .card.electric
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function spawnSpark(container){
    const s = document.createElement('div'); s.className='elec-spark';
    const r = container.getBoundingClientRect();
    // choose random position along border
    const side = Math.floor(Math.random()*4);
    let x=0,y=0;
    if(side===0){ // top
      x = r.left + Math.random()*r.width; y = r.top + Math.random()*6;
    } else if(side===1){ // right
      x = r.right - Math.random()*6; y = r.top + Math.random()*r.height;
    } else if(side===2){ // bottom
      x = r.left + Math.random()*r.width; y = r.bottom - Math.random()*6;
    } else { // left
      x = r.left + Math.random()*6; y = r.top + Math.random()*r.height;
    }
    s.style.left = (x - 3) + 'px'; s.style.top = (y - 3) + 'px';
    document.body.appendChild(s);
    // animate sparkle: fade in, float a bit, fade out
    s.animate([
      { transform: 'translateY(0) scale(0.6)', opacity: 0 },
      { transform: 'translateY(-6px) scale(1)', opacity: 1 },
      { transform: 'translateY(-12px) scale(0.4)', opacity: 0 }
    ], { duration: 900 + Math.random()*600, easing: 'cubic-bezier(.2,.9,.3,1)' });
    // cleanup
    setTimeout(()=> s.remove(), 1600 + Math.random()*600);
  }

  function tick(){
    const cards = document.querySelectorAll('.card.electric');
    cards.forEach(c=>{
      if(Math.random() < 0.35){ spawnSpark(c); }
    });
    setTimeout(tick, 700 + Math.random()*1600);
  }

  // Start after small delay
  setTimeout(tick, 1000);
})();
