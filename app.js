const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MEALS = [
  {key:'breakfast', label:'Breakfast', time:'Morning', mode:'vegnonveg'},
  {key:'lunch', label:'Lunch / Tiffin', time:'Midday', mode:'flat'},
  {key:'dinner', label:'Dinner', time:'Evening', mode:'categories'}
];
const DEFAULT_MENU = JSON.parse(JSON.stringify(MENU_DATA)); // deep copy, keyed by meal -> veg/nonveg

let state = {
  role: null,          // 'dad' | 'mom'
  day: DAYS[(new Date().getDay()+6)%7], // today, Mon-index
  data: {menu: DEFAULT_MENU, selections: {}}, // selections[day][mealkey] = {item,type,time}
  picker: null,        // mealkey when picker sheet is open
  pickType: null,       // 'veg'/'nonveg', a section name, or null for flat meals
  addText: '',
  addSectionOpen: false,
  addSectionText: ''
};

const STORAGE_KEY = 'app-data';

async function loadData(){
  try{
    const res = await window.storage.get(STORAGE_KEY, true);
    if(res && res.value){
      const parsed = JSON.parse(res.value);
      state.data = {
        menu: mergeMenu(parsed.menu),
        selections: parsed.selections || {}
      };
    }
  }catch(e){
    // no data yet — keep defaults
  }
  render();
}

// makes sure every meal key from MENU_DATA exists, even if saved data is older/partial
function mergeMenu(savedMenu){
  const merged = {};
  Object.keys(DEFAULT_MENU).forEach(mealKey=>{
    merged[mealKey] = (savedMenu && savedMenu[mealKey]) ? savedMenu[mealKey] : JSON.parse(JSON.stringify(DEFAULT_MENU[mealKey]));
  });
  return merged;
}

async function saveData(){
  try{
    await window.storage.set(STORAGE_KEY, JSON.stringify(state.data), true);
  }catch(e){
    console.error('save failed', e);
  }
}

function todayIdx(){ return (new Date().getDay()+6)%7; }

function selEntry(day, mealkey){
  return state.data.selections[day] && state.data.selections[day][mealkey];
}

function isItemSelected(day, mealkey, item, type){
  const entry = selEntry(day, mealkey);
  return !!(entry && entry.items.some(it => it.item===item && it.type===type));
}

// tapping an item adds it if not picked, removes it if already picked — supports multiple picks per meal
function toggleItem(day, mealkey, item, type){
  if(!state.data.selections[day]) state.data.selections[day] = {};
  let entry = state.data.selections[day][mealkey];
  if(!entry) entry = {items: [], time: ''};
  const idx = entry.items.findIndex(it => it.item===item && it.type===type);
  if(idx >= 0) entry.items.splice(idx, 1);
  else entry.items.push({item, type});
  entry.time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  if(entry.items.length === 0) delete state.data.selections[day][mealkey];
  else state.data.selections[day][mealkey] = entry;
  render();
  saveData();
}

function clearItem(day, mealkey){
  if(state.data.selections[day]) delete state.data.selections[day][mealkey];
  render();
  saveData();
}

function addMenuItem(){
  const text = state.addText.trim();
  if(!text || !state.picker) return;
  const meal = MEALS.find(m=>m.key===state.picker);
  if(meal.mode === 'flat'){
    state.data.menu[state.picker].push(text);
  }else{
    if(!state.data.menu[state.picker][state.pickType]) state.data.menu[state.picker][state.pickType] = [];
    state.data.menu[state.picker][state.pickType].push(text);
  }
  state.addText = '';
  render();
  saveData();
}

function delMenuItem(mealKey, type, idx){
  const meal = MEALS.find(m=>m.key===mealKey);
  if(meal.mode === 'flat'){
    state.data.menu[mealKey].splice(idx,1);
  }else{
    state.data.menu[mealKey][type].splice(idx,1);
  }
  render();
  saveData();
}

// dinner-only: create a brand new section (e.g. "Continental") on the fly
function addSection(){
  const name = state.addSectionText.trim();
  if(!name || !state.picker) return;
  if(!state.data.menu[state.picker][name]) state.data.menu[state.picker][name] = [];
  state.pickType = name;
  state.addSectionText = '';
  state.addSectionOpen = false;
  render();
  saveData();
}

function isProtectedSection(mealKey, name){
  return !!(MENU_DATA[mealKey] && Object.prototype.hasOwnProperty.call(MENU_DATA[mealKey], name));
}

function delSection(mealKey, name){
  if(isProtectedSection(mealKey, name)) return; // built-in sections can't be removed
  delete state.data.menu[mealKey][name];
  const remaining = Object.keys(state.data.menu[mealKey]);
  state.pickType = remaining[0] || null;
  render();
  saveData();
}

function renderRoleSwitch(){
  return `
  <div class="roleswitch">
    <button data-role="dad" class="${state.role==='dad'?'active':''}">👨 I'm Dad</button>
    <button data-role="mom" class="${state.role==='mom'?'active':''}">👩 I'm Mom</button>
  </div>`;
}

function renderDayTabs(){
  return `<div class="daytabs">${DAYS.map((d,i)=>`
    <button data-day="${d}" class="${state.day===d?'active':''} ${i===todayIdx()?'istoday':''}">${d}</button>
  `).join('')}</div>`;
}

// veg/nonveg get their own color; anything else (a section name, or nothing) is neutral
function slipClassFor(it){
  return (it.type === 'veg' || it.type === 'nonveg') ? it.type : 'plain';
}
function slipTagFor(it){
  return (it.type && it.type !== 'veg' && it.type !== 'nonveg') ? it.type : null;
}

function renderMealCardDad(meal){
  const entry = selEntry(state.day, meal.key);
  const hasItems = entry && entry.items.length > 0;
  return `
  <div class="meal-card">
    <div class="meal-head">
      <div class="meal-name">${meal.label}</div>
      <div class="meal-time">${meal.time}</div>
    </div>
    ${hasItems ? `
      <div class="selected-items clickable" data-open="${meal.key}">
        ${entry.items.map(it => `
          <div class="slip ${slipClassFor(it)}">
            <div class="dot"></div>
            <div class="item">${slipTagFor(it) ? `<span class="cattag">${slipTagFor(it)}</span>` : ''}${it.item}</div>
          </div>
        `).join('')}
        <div class="stamp-row">tap to edit · sent ${entry.time}</div>
      </div>
    ` : `
      <div class="slot-empty" data-open="${meal.key}">+ Choose what's for ${meal.label.toLowerCase()}</div>
    `}
  </div>`;
}

function renderMealCardMom(meal){
  const entry = selEntry(state.day, meal.key);
  const hasItems = entry && entry.items.length > 0;
  return `
  <div class="meal-card">
    <div class="meal-head">
      <div class="meal-name">${meal.label}</div>
      <div class="meal-time">${meal.time}</div>
    </div>
    ${hasItems ? `
      <div class="selected-items">
        ${entry.items.map(it => `
          <div class="slip ${slipClassFor(it)}">
            <div class="dot"></div>
            <div class="item">${slipTagFor(it) ? `<span class="cattag">${slipTagFor(it)}</span>` : ''}${it.item}</div>
          </div>
        `).join('')}
        <div class="stamp-row">picked at ${entry.time}</div>
      </div>
    ` : `
      <div class="waiting"><span class="bell">🔔</span> Waiting for Dad to choose…</div>
    `}
  </div>`;
}

function renderPicker(){
  if(!state.picker) return '';
  const mealkey = state.picker;
  const meal = MEALS.find(m=>m.key===mealkey);

  let selectorHtml = '';
  let list = [];

  if(meal.mode === 'vegnonveg'){
    list = (state.data.menu[mealkey] && state.data.menu[mealkey][state.pickType]) || [];
    selectorHtml = `
      <div class="typetoggle">
        <button class="veg ${state.pickType==='veg'?'active':''}" data-cat="veg"><span class="dot veg"></span>Veg</button>
        <button class="nonveg ${state.pickType==='nonveg'?'active':''}" data-cat="nonveg"><span class="dot nonveg"></span>Non-Veg</button>
      </div>`;
  } else if(meal.mode === 'categories'){
    const sections = Object.keys(state.data.menu[mealkey] || {});
    list = (state.data.menu[mealkey] && state.data.menu[mealkey][state.pickType]) || [];
    selectorHtml = `
      <div class="categorytabs">
        ${sections.map(sec => `<button data-cat="${sec}" class="${state.pickType===sec?'active':''}">${sec}</button>`).join('')}
      </div>
      <div class="addsection">
        <button id="toggleAddSection">${state.addSectionOpen ? 'Cancel' : '+ New section'}</button>
        ${(state.pickType && !isProtectedSection(mealkey, state.pickType)) ? `<button id="delSectionBtn" class="delsection">Delete "${state.pickType}" section</button>` : ''}
      </div>
      ${state.addSectionOpen ? `
        <div class="addrow" style="margin-bottom:14px;">
          <input id="addSectionInput" placeholder="Section name (e.g. Continental)" value="${state.addSectionText}">
          <button id="addSectionBtn">Add</button>
        </div>
      ` : ''}
    `;
  } else {
    list = state.data.menu[mealkey] || [];
  }

  return `
  <div class="overlay" id="overlay">
    <div class="sheet">
      <div class="sheet-head">
        <h2>${meal.label} — ${state.day}</h2>
        <button id="closeSheet">✕</button>
      </div>
      ${selectorHtml}
      <div class="menulist">
        ${list.map((item,idx)=>{
          const typeVal = meal.mode === 'flat' ? null : state.pickType;
          const picked = isItemSelected(state.day, mealkey, item, typeVal);
          return `
          <div class="menuitem ${picked ? 'selected' : ''}" data-pick="${idx}">
            <span>${picked ? '✓ ' : ''}${item}</span>
            <span class="del" data-del="${idx}">✕</span>
          </div>`;
        }).join('') || '<div style="color:var(--ink-soft);font-size:13px;padding:8px 2px;">No items yet — add one below.</div>'}
      </div>
      <div class="addrow">
        <input id="addInput" placeholder="Add a new dish…" value="${state.addText}">
        <button id="addBtn">Add</button>
      </div>
      ${(selEntry(state.day, mealkey) && selEntry(state.day, mealkey).items.length) ? `<div style="margin-top:12px;text-align:center;"><button id="clearSel" style="background:none;border:none;color:var(--terracotta);font-size:13px;cursor:pointer;text-decoration:underline;">Clear all selections for this meal</button></div>` : ''}
      <button id="doneBtn" class="donebtn">Done</button>
    </div>
  </div>`;
}

function render(){
  const app = document.getElementById('app');

  if(!state.role){
    app.innerHTML = `
      <div class="masthead">
        <div class="eyebrow">Home Kitchen</div>
        <h1>What's Cooking?</h1>
        <div class="sub">Dad picks. Mom sees it instantly.</div>
      </div>
      ${renderRoleSwitch()}
      <div class="footnote">Choose who you are to get started. Both of you should open this same page — Dad picks a dish and it appears on Mom's screen right away, no calls needed.</div>
    `;
    bindGlobal();
    return;
  }

  const cards = MEALS.map(m => state.role==='dad' ? renderMealCardDad(m) : renderMealCardMom(m)).join('');

  app.innerHTML = `
    <div class="masthead">
      <div class="eyebrow">Home Kitchen</div>
      <h1>What's Cooking?</h1>
      <div class="sub">${state.role==='dad' ? 'Pick a dish for each meal' : "Today's menu, picked by Dad"}</div>
    </div>
    ${renderDayTabs()}
    ${cards}
    ${state.role==='mom' ? `<div class="footnote">This screen updates on its own every few seconds.</div>` : `<div class="footnote">Tap a meal to choose from the menu, or add a new dish while you're there.</div>`}
    <div class="switchuser"><button id="switchRole">Not ${state.role==='dad'?'Dad':'Mom'}? Switch user</button></div>
    ${renderPicker()}
  `;
  bindGlobal();
}

function bindGlobal(){
  const app = document.getElementById('app');

  app.querySelectorAll('[data-role]').forEach(b=>{
    b.onclick = ()=>{ state.role = b.dataset.role; render(); };
  });

  const switchBtn = document.getElementById('switchRole');
  if(switchBtn) switchBtn.onclick = ()=>{ state.role = null; render(); };

  app.querySelectorAll('[data-day]').forEach(b=>{
    b.onclick = ()=>{ state.day = b.dataset.day; render(); };
  });

  app.querySelectorAll('[data-open]').forEach(b=>{
    b.onclick = ()=>{
      state.picker = b.dataset.open;
      const meal = MEALS.find(m=>m.key===state.picker);
      const entry = selEntry(state.day, state.picker);
      const lastType = (entry && entry.items.length) ? entry.items[entry.items.length-1].type : null;
      state.addSectionOpen = false;
      state.addSectionText = '';
      if(meal.mode === 'flat'){
        state.pickType = null;
      } else if(meal.mode === 'vegnonveg'){
        state.pickType = lastType || 'veg';
      } else { // categories
        const sections = Object.keys(state.data.menu[state.picker] || {});
        state.pickType = (lastType && sections.includes(lastType)) ? lastType : sections[0] || null;
      }
      render();
    };
  });

  const closeBtn = document.getElementById('closeSheet');
  if(closeBtn) closeBtn.onclick = ()=>{ state.picker=null; render(); };
  const doneBtn = document.getElementById('doneBtn');
  if(doneBtn) doneBtn.onclick = ()=>{ state.picker=null; render(); };
  const overlay = document.getElementById('overlay');
  if(overlay) overlay.onclick = (e)=>{ if(e.target===overlay){ state.picker=null; render(); } };

  app.querySelectorAll('[data-cat]').forEach(b=>{
    b.onclick = ()=>{ state.pickType = b.dataset.cat; state.addSectionOpen = false; render(); };
  });

  const toggleAddSection = document.getElementById('toggleAddSection');
  if(toggleAddSection) toggleAddSection.onclick = ()=>{ state.addSectionOpen = !state.addSectionOpen; render(); };

  const addSectionInput = document.getElementById('addSectionInput');
  if(addSectionInput){
    addSectionInput.oninput = (e)=>{ state.addSectionText = e.target.value; };
    addSectionInput.onkeydown = (e)=>{ if(e.key==='Enter') addSection(); };
  }
  const addSectionBtn = document.getElementById('addSectionBtn');
  if(addSectionBtn) addSectionBtn.onclick = addSection;

  const delSectionBtn = document.getElementById('delSectionBtn');
  if(delSectionBtn) delSectionBtn.onclick = ()=>{ delSection(state.picker, state.pickType); };

  app.querySelectorAll('[data-pick]').forEach(b=>{
    b.onclick = (e)=>{
      if(e.target.dataset.del !== undefined) return;
      const idx = +b.dataset.pick;
      const meal = MEALS.find(m=>m.key===state.picker);
      const item = meal.mode === 'flat'
        ? state.data.menu[state.picker][idx]
        : state.data.menu[state.picker][state.pickType][idx];
      toggleItem(state.day, state.picker, item, meal.mode === 'flat' ? null : state.pickType);
    };
  });

  app.querySelectorAll('[data-del]').forEach(b=>{
    b.onclick = (e)=>{
      e.stopPropagation();
      delMenuItem(state.picker, state.pickType, +b.dataset.del);
    };
  });

  const clearSel = document.getElementById('clearSel');
  if(clearSel) clearSel.onclick = ()=>{ clearItem(state.day, state.picker); };

  const addInput = document.getElementById('addInput');
  if(addInput){
    addInput.oninput = (e)=>{ state.addText = e.target.value; };
    addInput.onkeydown = (e)=>{ if(e.key==='Enter'){ addMenuItem(); const i=document.getElementById('addInput'); if(i) i.focus(); } };
  }
  const addBtn = document.getElementById('addBtn');
  if(addBtn) addBtn.onclick = ()=>{ addMenuItem(); const i=document.getElementById('addInput'); if(i) i.focus(); };
}

loadData();

// poll for updates so Mom's screen (and Dad's) stays in sync without refreshing
setInterval(async ()=>{
  if(state.picker) return; // don't disrupt an open picker
  try{
    const res = await window.storage.get(STORAGE_KEY, true);
    if(res && res.value){
      const parsed = JSON.parse(res.value);
      const newStr = JSON.stringify(parsed);
      const oldStr = JSON.stringify(state.data);
      if(newStr !== oldStr){
        state.data = {menu: mergeMenu(parsed.menu), selections: parsed.selections || {}};
        render();
      }
    }
  }catch(e){ /* ignore transient errors */ }
}, 4000);