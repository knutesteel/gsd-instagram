(() => {
  const DATA = window.GSD_CONTENT_PLAN_DATA;
  if (!DATA) return;
  const STORAGE_KEY = 'gsd-content-plan-edits-v2';
  const statuses = ['Idea','Planned','Writing','Artwork','Review','Scheduled','Published','Performance Review','Evergreen Library','Archived'];
  const state = { tab:'plan', search:'', category:'', format:'', cta:'', destination:'', status:'', ad:'', sort:'Post #', direction:1 };
  let edits = {};
  try { edits = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { edits = {}; }
  let root = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const unique = (field) => [...new Set(DATA.posts.map(p => p[field]).filter(Boolean))].sort();
  const post = (p) => ({ ...p, ...(edits[p['Post #']] || {}) });
  const save = (id, patch) => { edits[id] = { ...(edits[id] || {}), ...patch }; localStorage.setItem(STORAGE_KEY, JSON.stringify(edits)); };
  const filtered = () => DATA.posts.map(post).filter(p => {
    const hay = Object.values(p).join(' ').toLowerCase();
    return (!state.search || hay.includes(state.search.toLowerCase())) &&
      (!state.category || p.Category === state.category) &&
      (!state.format || p.Format === state.format) &&
      (!state.cta || p['Primary CTA'] === state.cta) &&
      (!state.destination || p.Destination === state.destination) &&
      (!state.status || p.Status === state.status) &&
      (!state.ad || (state.ad === 'yes' ? [1,38,69].includes(Number(p['Post #'])) : ![1,38,69].includes(Number(p['Post #']))));
  }).sort((a,b) => {
    const av = a[state.sort] ?? '', bv = b[state.sort] ?? '';
    return (typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv))) * state.direction;
  });

  function summary(){
    const all = DATA.posts.map(post);
    const scheduled = all.filter(p => ['Scheduled','Published','Performance Review','Evergreen Library'].includes(p.Status)).length;
    const published = all.filter(p => ['Published','Performance Review','Evergreen Library'].includes(p.Status)).length;
    return `<div class="content-plan-cards"><div class="content-plan-card"><span>Total Posts</span><strong>${all.length}</strong></div><div class="content-plan-card"><span>Scheduled</span><strong>${scheduled}</strong></div><div class="content-plan-card"><span>Published</span><strong>${published}</strong></div><div class="content-plan-card"><span>Ad Candidates</span><strong>3</strong></div></div>`;
  }
  function planView(){
    const rows = filtered();
    const opts = (vals, selected) => `<option value="">All</option>${vals.map(v => `<option ${v===selected?'selected':''}>${esc(v)}</option>`).join('')}`;
    return `${summary()}<div class="content-plan-panel"><div class="content-plan-filters"><input data-filter="search" placeholder="Search all post ideas…" value="${esc(state.search)}"><select data-filter="category">${opts(unique('Category'),state.category)}</select><select data-filter="format">${opts(unique('Format'),state.format)}</select><select data-filter="cta">${opts(unique('Primary CTA'),state.cta)}</select><select data-filter="destination">${opts(unique('Destination'),state.destination)}</select><select data-filter="status">${opts(statuses,state.status)}</select><select data-filter="ad"><option value="">All Ad Status</option><option value="yes" ${state.ad==='yes'?'selected':''}>Ad Candidates</option><option value="no" ${state.ad==='no'?'selected':''}>Not Ad Candidates</option></select></div><div class="content-plan-table-wrap"><table class="content-plan-table"><thead><tr>${['Post #','Publish Date','Day','Category','Post Title','Concept','Format','Primary CTA','Destination','Status','Performance Notes','Ad Candidate'].map(h=>`<th data-sort="${h}">${h}${state.sort===h?(state.direction===1?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr><td>${p['Post #']}</td><td>${esc(p['Publish Date'])}</td><td>${esc(p.Day)}</td><td><span class="content-plan-badge">${esc(p.Category)}</span></td><td><b>${esc(p['Post Title'])}</b></td><td>${esc(p.Concept)}</td><td>${esc(p.Format)}</td><td>${esc(p['Primary CTA'])}</td><td>${esc(p.Destination)}</td><td><select data-edit-status="${p['Post #']}">${statuses.map(s=>`<option ${s===p.Status?'selected':''}>${s}</option>`).join('')}</select></td><td><textarea data-edit-notes="${p['Post #']}" placeholder="Add performance notes…">${esc(p['Performance Notes']||'')}</textarea></td><td>${[1,38,69].includes(Number(p['Post #']))?'<span class="content-plan-badge">Yes</span>':'No'}</td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<div class="content-plan-empty">No posts match the current filters.</div>'}</div>`;
  }
  function mixView(){ return `<div class="content-plan-panel"><h2>Recommended Content Mix</h2>${DATA.mix.map(m=>`<div class="content-mix-row"><strong>${esc(m.category)}</strong><div class="content-mix-bar"><div class="content-mix-fill" style="width:${m.posts}%"></div></div><span>${m.posts} posts</span></div>`).join('')}</div>`; }
  function scheduleView(){ const byMonth={}; DATA.posts.map(post).forEach(p=>{const m=p['Publish Date'].slice(0,7);(byMonth[m]||(byMonth[m]=[])).push(p)}); return `<div class="content-plan-grid"><div class="content-plan-panel"><h2>Weekly Posting Rhythm</h2>${DATA.rhythm.map(r=>`<div class="content-plan-schedule"><strong>${esc(r[0])}</strong><span>${esc(r[1])}</span></div>`).join('')}</div><div class="content-plan-panel"><h2>Plan by Month</h2>${Object.entries(byMonth).map(([m,posts])=>`<div class="content-plan-schedule"><strong>${new Date(m+'-01T12:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'})}</strong><span>${posts.length} posts · ${posts[0]['Publish Date']} through ${posts[posts.length-1]['Publish Date']}</span></div>`).join('')}</div></div>`; }
  function adsView(){ return `<div class="content-plan-panel"><h2>Recommended Ad Campaigns</h2>${DATA.ads.map(a=>`<article class="content-plan-ad"><h3>${esc(a.Campaign)}</h3><div class="content-plan-ad-grid">${Object.entries(a).filter(([k])=>k!=='Campaign').map(([k,v])=>`<div class="content-plan-ad-field"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div></article>`).join('')}</div>`; }
  function exportCsv(){ const rows=filtered(), headers=['Post #','Publish Date','Day','Category','Post Title','Concept','Format','Primary CTA','Destination','Status','Performance Notes','Ad Candidate']; const csv=[headers,...rows.map(p=>headers.map(h=>h==='Ad Candidate'?([1,38,69].includes(Number(p['Post #']))?'Yes':'No'):(p[h]??'')))].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='gsd-content-plan-filtered.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),0); }
  function render(){ if(!root) return; root.innerHTML=`<div class="content-plan-header"><div><h1>Content Plan</h1><p>100-post editorial plan for executive dysfunction, ADHD, overwhelm, productivity and the Hank &amp; the Squirrel ecosystem.</p></div><div class="content-plan-actions"><button class="content-plan-btn" data-action="close">Close</button><button class="content-plan-btn" data-action="export">Export Filtered CSV</button><button class="content-plan-btn" data-action="print">Print</button></div></div><div class="content-plan-tabs">${[['plan','Content Library'],['mix','Content Mix'],['schedule','Posting Schedule'],['ads','Ad Recommendations']].map(([k,l])=>`<button class="content-plan-tab ${state.tab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</div>${state.tab==='plan'?planView():state.tab==='mix'?mixView():state.tab==='schedule'?scheduleView():adsView()}`; bind(); }
  function bind(){ root.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{state.tab=el.dataset.tab;render()}); root.querySelector('[data-action="close"]')?.addEventListener('click',hide); root.querySelector('[data-action="export"]')?.addEventListener('click',exportCsv); root.querySelector('[data-action="print"]')?.addEventListener('click',()=>window.print()); root.querySelectorAll('[data-filter]').forEach(el=>el.onchange=el.oninput=()=>{state[el.dataset.filter]=el.value;render()}); root.querySelectorAll('[data-sort]').forEach(el=>el.onclick=()=>{const key=el.dataset.sort;if(state.sort===key)state.direction*=-1;else{state.sort=key;state.direction=1}render()}); root.querySelectorAll('[data-edit-status]').forEach(el=>el.onchange=()=>save(el.dataset.editStatus,{Status:el.value})); root.querySelectorAll('[data-edit-notes]').forEach(el=>el.onchange=()=>save(el.dataset.editNotes,{'Performance Notes':el.value})); }
  function show(event){ event?.preventDefault(); event?.stopPropagation(); if(root){render();return;} const main=document.querySelector('.main-content'); if(!main)return; root=document.createElement('section'); root.className='content-plan-root content-plan-overlay'; main.appendChild(root); document.querySelectorAll('.sidebar .nav-item').forEach(n=>n.classList.remove('active')); document.querySelector('.content-plan-nav')?.classList.add('active'); render(); }
  function hide(){ root?.remove(); root=null; document.querySelector('.content-plan-nav')?.classList.remove('active'); }
  function install(){ const nav=document.querySelector('.sidebar nav'); if(!nav)return false; let btn=document.querySelector('.content-plan-nav'); if(!btn){ const insights=[...nav.querySelectorAll('button')].find(b=>b.textContent.trim()==='Instagram Insights'); btn=document.createElement('button'); btn.type='button'; btn.className='nav-item content-plan-nav'; btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 4h16v16H4zM8 2v4M16 2v4M4 9h16M8 13h3M13 13h3M8 17h3"/></svg><span>Content Plan</span>'; insights?.after(btn); }
    btn.addEventListener('click',show,true);
    nav.addEventListener('click',e=>{ const target=e.target.closest('button'); if(target && !target.classList.contains('content-plan-nav')) hide(); },true);
    return true;
  }
  const timer=setInterval(()=>{if(install())clearInterval(timer)},200);
})();