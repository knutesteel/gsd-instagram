(() => {
  let root = null;
  const modules = [
    ['Dashboard','See current workload, queue health, approvals, posting activity and overall progress.'],
    ['Discover','Find current stories, analyze an article URL, or turn a text overview into a new idea.'],
    ['Generation Details','Review and refine story concepts, captions, formats, prompts and production status.'],
    ['Instagram Insights','Track account growth, post performance, followers, following and saved items.'],
    ['Content Plan','Manage the editorial calendar, content mix, posting cadence, ad candidates and ad-hoc ideas.'],
    ['Archive','Review completed, rejected, disqualified or retired items without cluttering active work.']
  ];
  const statuses = [
    ['Concept','Planned in the Content Plan but not yet in the production queue.'],
    ['New','Added to the Story Queue and ready for review or development.'],
    ['Sent to Sheets','Sent to the connected generation spreadsheet.'],
    ['Generated','Generation output has been created.'],
    ['Approved','Reviewed and ready to publish.'],
    ['Posted','Published on Instagram.'],
    ['Archived','Finished or removed from the active workflow.']
  ];
  const categories = [
    ['Recognition','Relatable executive dysfunction, ADHD and overwhelm moments.'],
    ['Science','Simple explanations of attention, motivation and behavior.'],
    ['Tools','Practical GSD methods, prompts and small actions.'],
    ['Stories','Character-led Hank, squirrel and Murphy narratives.'],
    ['Book','Book ideas, excerpts, lessons and promotion.'],
    ['News','Current events interpreted through the GSD lens.'],
    ['Community','Newsletter, app, audience and ecosystem content.']
  ];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function moduleButton(name){
    return `<button class="instructions-open" data-open-module="${esc(name)}">Open ${esc(name)}</button>`;
  }
  function render(){
    if(!root) return;
    root.innerHTML = `
      <div class="instructions-header">
        <div><h1>Instructions</h1><p>How to move ideas from inspiration to published, measurable Instagram content.</p></div>
        <button class="content-plan-btn" data-action="close-instructions">Close</button>
      </div>

      <section class="instructions-hero">
        <h2>Workflow</h2>
        <div class="instructions-flow">
          ${['Capture Idea','Story Queue','Review','Content Plan','Send to Queue','Generate','Approve','Post','Performance','Evergreen'].map((step,i)=>`<div class="instructions-flow-step"><span>${i+1}</span><strong>${step}</strong></div>${i<9?'<div class="instructions-arrow">→</div>':''}`).join('')}
        </div>
        <p><strong>Story Queue</strong> is the creative inbox for ad-hoc ideas. <strong>Content Plan</strong> is the intentional editorial calendar. Ideas can be placed into an existing slot, moved to a better slot, or added as a new series when they do not fit the current plan.</p>
      </section>

      <section class="instructions-grid">
        <article class="instructions-card">
          <h2>Quick Start</h2>
          <ol>
            <li>Capture an idea manually or create one through Discover.</li>
            <li>Review the idea and decide whether it belongs in the editorial plan.</li>
            <li>Place it into the Content Plan or add a new series.</li>
            <li>Use <strong>Send to Queue</strong> to create the production record with status <strong>New</strong>.</li>
            <li>Develop the content, send it to Sheets, generate it and review it.</li>
            <li>Mark it Approved, then Posted after publication.</li>
            <li>Use Instagram Insights to evaluate performance and identify evergreen winners.</li>
          </ol>
        </article>
        <article class="instructions-card">
          <h2>Recommended Routine</h2>
          <h3>Daily</h3>
          <p>Review new ideas, process the queue, generate the next posts and update statuses as work advances.</p>
          <h3>Weekly</h3>
          <p>Review category balance, fill calendar gaps, evaluate analytics, refresh strong concepts and archive dead ends.</p>
          <h3>Monthly</h3>
          <p>Compare planned content with actual performance and adjust the next month’s mix, cadence and ad candidates.</p>
        </article>
      </section>

      <section class="instructions-section">
        <h2>Module Guide</h2>
        <div class="instructions-grid">${modules.map(([name,desc])=>`<article class="instructions-card"><h3>${esc(name)}</h3><p>${esc(desc)}</p>${moduleButton(name)}</article>`).join('')}</div>
      </section>

      <section class="instructions-section">
        <h2>Status Reference</h2>
        <div class="instructions-table-wrap"><table class="instructions-table"><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody>${statuses.map(([s,d])=>`<tr><td><span class="content-plan-badge">${esc(s)}</span></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="instructions-section">
        <h2>Content Strategy</h2>
        <div class="instructions-grid">${categories.map(([name,desc])=>`<article class="instructions-card compact"><h3>${esc(name)}</h3><p>${esc(desc)}</p></article>`).join('')}</div>
      </section>

      <section class="instructions-grid">
        <article class="instructions-card">
          <h2>Best Practices</h2>
          <ul>
            <li>Capture ideas immediately; organize them later.</li>
            <li>Use Content Plan for intentional publishing, not as a dumping ground.</li>
            <li>Keep one status vocabulary across modules.</li>
            <li>Use the item identifier to trace a story through the entire workflow.</li>
            <li>Do not create duplicates when a queued record already exists.</li>
            <li>Review category gaps before adding more News content.</li>
          </ul>
        </article>
        <article class="instructions-card">
          <h2>Release Notes</h2>
          <details open><summary>Current</summary><p>Added Instructions, Content Plan, ad-hoc idea capture, queue synchronization, labeled filters and unified statuses.</p></details>
          <details><summary>Earlier</summary><p>Added Instagram Insights, saved-item analysis, generation synchronization and production workflow controls.</p></details>
        </article>
      </section>`;
    bind();
  }
  function openModule(name){
    hide();
    if(name === 'Content Plan'){
      document.querySelector('.content-plan-nav')?.click();
      return;
    }
    const buttons=[...document.querySelectorAll('.sidebar nav button')];
    const target=buttons.find(b=>b.textContent.trim()===name);
    target?.click();
  }
  function bind(){
    root.querySelector('[data-action="close-instructions"]')?.addEventListener('click',hide);
    root.querySelectorAll('[data-open-module]').forEach(btn=>btn.addEventListener('click',()=>openModule(btn.dataset.openModule)));
  }
  function show(event){
    event?.preventDefault(); event?.stopPropagation();
    if(root){render();return;}
    document.querySelector('.content-plan-nav')?.classList.remove('active');
    const main=document.querySelector('.main-content');
    if(!main) return;
    root=document.createElement('section');
    root.className='instructions-root instructions-overlay';
    main.appendChild(root);
    document.querySelectorAll('.sidebar .nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelector('.instructions-nav')?.classList.add('active');
    render();
  }
  function hide(){
    root?.remove(); root=null;
    document.querySelector('.instructions-nav')?.classList.remove('active');
  }
  function install(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav) return false;
    let btn=document.querySelector('.instructions-nav');
    if(!btn){
      const dashboard=[...nav.querySelectorAll('button')].find(b=>b.textContent.trim()==='Dashboard');
      btn=document.createElement('button');
      btn.type='button';
      btn.className='nav-item instructions-nav';
      btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg><span>Instructions</span>';
      dashboard?.after(btn);
    }
    btn.addEventListener('click',show,true);
    nav.addEventListener('click',e=>{
      const target=e.target.closest('button');
      if(target && !target.classList.contains('instructions-nav')) hide();
    },true);
    return true;
  }
  const timer=setInterval(()=>{if(install())clearInterval(timer)},200);
})();