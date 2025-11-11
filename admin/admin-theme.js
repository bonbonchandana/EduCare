(function(){
  // Add a subtle moving highlight behind the UI and gentle hover lift for sidebar links
  const hl = document.createElement('div'); hl.className = 'admin-highlight'; document.body.appendChild(hl);

  // small breathing animation
  hl.animate([
    { transform: 'translateY(0) scale(0.98)', opacity:0.06 },
    { transform: 'translateY(-20px) scale(1.02)', opacity:0.1 },
    { transform: 'translateY(0) scale(0.98)', opacity:0.06 }
  ], { duration: 9000, iterations: Infinity, easing: 'ease-in-out' });

  // Add gentle hover lift via event delegation to keep markup unchanged
  document.addEventListener('mouseover', (e)=>{
    const a = e.target.closest('.sidebar .nav a');
    if(a) a.style.transform = 'translateY(-4px) scale(1.02)';
  });
  document.addEventListener('mouseout', (e)=>{
    const a = e.target.closest('.sidebar .nav a');
    if(a) a.style.transform = '';
  });
})();
