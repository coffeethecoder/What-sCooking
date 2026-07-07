const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; // matches Date.getDay()
const MEALS = [
  {key:'breakfast', label:'Breakfast', time:'Morning', mode:'vegnonveg'},
  {key:'lunch', label:'Lunch / Tiffin', time:'Midday', mode:'flat'},
  {key:'dinner', label:'Dinner', time:'Evening', mode:'categories'}
];
const DEFAULT_MENU = JSON.parse(JSON.stringify(MENU_DATA)); // deep copy, keyed by meal -> veg/nonveg

function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function dateKey(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(d, n){ const r = new Date(d); r.setDate(d.getDate()+n); return r; }
function startOfWeek(d){ // Monday-based week
  const day = d.getDay();
  const diff = (day === 0) ? -6 : (1 - day);
  const r = new Date(d);
  r.setDate(d.getDate()+diff);
  r.setHours(0,0,0,0);
  return r;
}
// Dad's fasting days: the 9th, 18th, 27th of every month, and every Thursday
function isFastingDay(d){
  const dom = d.getDate();
  return dom===9 || dom===18 || dom===27 || d.getDay()===4;
}
function formatDateLabel(d){
  return `${DAY_ABBR[d.getDay()]}, ${d.getDate()} ${d.toLocaleDateString('en-US',{month:'short'})}`;
}

const ROLE_LABELS = {dad: 'Dad', mom: 'Mom', khyati: 'Khyati'};
const OWNER_LABELS = {dad: '👨 Dad', khyati: '👧 Khyati'};
function isEditorRole(){ return state.role === 'dad' || state.role === 'khyati'; }
function showsFasting(){ return state.role === 'dad' || state.role === 'mom'; } // Khyati's view skips the fasting stuff
function otherEditor(){ return state.role === 'dad' ? 'khyati' : 'dad'; }

// each meal can now hold Dad's own pick AND Khyati's own pick, side by side, tagged by who chose it
function personPicks(entry, person){
  return (entry && entry.items) ? entry.items.filter(it => it.by === person) : [];
}
function personSkipped(entry, person){
  return !!(entry && entry.skips && entry.skips.includes(person));
}

// old data (from before Khyati existed) had no "by" field and a single shared "skipped" flag —
// treat that legacy data as Dad's, since he was the only one picking back then
function migrateSelections(saved){
  const out = {};
  Object.keys(saved || {}).forEach(day=>{
    out[day] = {};
    Object.keys(saved[day] || {}).forEach(mealkey=>{
      const e = saved[day][mealkey] || {};
      const items = (e.items || []).map(it => it.by ? it : {...it, by:'dad'});
      const skips = e.skips ? e.skips : (e.skipped ? ['dad'] : []);
      out[day][mealkey] = {items, skips, time: e.time || ''};
    });
  });
  return out;
}

let state = {
  role: null,          // 'dad' | 'mom'
  weekStart: startOfWeek(new Date()), // Monday of the currently displayed week
  day: dateKey(new Date()), // selected date, as "YYYY-MM-DD"
  data: {menu: DEFAULT_MENU, selections: {}, khyatiHome: false}, // khyatiHome: whether her profile/features are unlocked right now
  picker: null,        // mealkey when picker sheet is open
  pickType: null,       // 'veg'/'nonveg', a section name, or null for flat meals
  addText: '',
  addSectionOpen: false,
  addSectionText: ''
};

const STORAGE_KEY = 'app-data';
let seeded = false;

async function saveData(){
  try{
    await db.ref(STORAGE_KEY).set(state.data);
  }catch(e){
    console.error('save failed', e);
  }
}

// makes sure every meal key from MENU_DATA exists, even if saved data is older/partial
function mergeMenu(savedMenu){
  const merged = {};
  Object.keys(DEFAULT_MENU).forEach(mealKey=>{
    const def = DEFAULT_MENU[mealKey];
    const saved = savedMenu && savedMenu[mealKey];
    if(Array.isArray(def)){
      // flat list (e.g. lunch) — start with every built-in dish, then add any extras that were saved
      const combined = JSON.parse(JSON.stringify(def));
      if(saved && Array.isArray(saved)){
        saved.forEach(item => { if(!combined.includes(item)) combined.push(item); });
      }
      merged[mealKey] = combined;
    } else {
      // keyed by veg/nonveg or by section (e.g. breakfast, dinner)
      const mergedObj = (saved && typeof saved === 'object') ? {...saved} : {};
      Object.keys(def).forEach(subKey=>{
        const defList = def[subKey];
        const savedList = mergedObj[subKey];
        const combined = JSON.parse(JSON.stringify(defList));
        if(savedList && Array.isArray(savedList)){
          savedList.forEach(item => { if(!combined.includes(item)) combined.push(item); });
        }
        mergedObj[subKey] = combined;
      });
      merged[mealKey] = mergedObj;
    }
  });
  return merged;
}

// live sync: pushes Dad's picks to Mom's screen (and vice versa) instantly, no polling needed
function startSync(){
  db.ref(STORAGE_KEY).on('value', (snapshot)=>{
    const val = snapshot.val();
    if(val){
      state.data = {
        menu: mergeMenu(val.menu),
        selections: migrateSelections(val.selections),
        khyatiHome: typeof val.khyatiHome === 'boolean' ? val.khyatiHome : false
      };
      if(!state.data.khyatiHome && state.role === 'khyati'){
        state.role = null; // her profile just got locked — send this device back to the role screen
      }
    } else if(!seeded){
      seeded = true;
      saveData(); // nothing in the database yet — seed it with our defaults
    }
    if(!state.picker) render(); // don't yank the picker sheet out from under someone mid-selection
  }, (err)=>{
    console.error('sync error', err);
  });
}

function getWeekDates(){
  const dates = [];
  for(let i=0;i<7;i++) dates.push(addDays(state.weekStart, i));
  return dates;
}

function shiftWeek(deltaDays){
  const selectedDate = parseDateKey(state.day);
  const offsetDays = Math.round((selectedDate - state.weekStart) / (1000*60*60*24));
  state.weekStart = addDays(state.weekStart, deltaDays);
  state.day = dateKey(addDays(state.weekStart, offsetDays));
  render();
}

function jumpToToday(){
  state.weekStart = startOfWeek(new Date());
  state.day = dateKey(new Date());
  render();
}

function clearWeek(){
  if(!window.confirm('Clear all picks for this week? This can\'t be undone.')) return;
  getWeekDates().forEach(d => { delete state.data.selections[dateKey(d)]; });
  render();
  saveData();
}

function showToast(msg){
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(()=> toast.classList.add('show'));
  setTimeout(()=>{
    toast.classList.remove('show');
    setTimeout(()=> toast.remove(), 300);
  }, 1800);
}

function selEntry(day, mealkey){
  return state.data.selections[day] && state.data.selections[day][mealkey];
}

function isItemSelected(day, mealkey, item, type){
  const entry = selEntry(day, mealkey);
  const person = state.role; // only Dad or Khyati can open the picker, so this is always one of them
  return personPicks(entry, person).some(it => it.item===item && it.type===type);
}

// tapping an item adds it if not picked, removes it if already picked — supports multiple picks per meal,
// tagged to whichever of Dad/Khyati is currently using the app
function toggleItem(day, mealkey, item, type){
  const person = state.role;
  if(!state.data.selections[day]) state.data.selections[day] = {};
  let entry = state.data.selections[day][mealkey];
  if(!entry) entry = {items: [], skips: [], time: ''};
  if(!entry.items) entry.items = [];
  if(!entry.skips) entry.skips = [];
  entry.skips = entry.skips.filter(p => p !== person); // picking food cancels this person's "not eating" mark
  const idx = entry.items.findIndex(it => it.item===item && it.type===type && it.by===person);
  if(idx >= 0) entry.items.splice(idx, 1);
  else entry.items.push({item, type, by: person});
  entry.time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  if(entry.items.length === 0 && entry.skips.length === 0) delete state.data.selections[day][mealkey];
  else state.data.selections[day][mealkey] = entry;
  render();
  saveData();
}

// marks a meal as "not eating today" for whichever of Dad/Khyati is using the app (or undoes that mark)
function toggleSkip(day, mealkey){
  const person = state.role;
  if(!state.data.selections[day]) state.data.selections[day] = {};
  let entry = state.data.selections[day][mealkey];
  if(!entry) entry = {items: [], skips: [], time: ''};
  if(!entry.items) entry.items = [];
  if(!entry.skips) entry.skips = [];
  if(entry.skips.includes(person)){
    entry.skips = entry.skips.filter(p => p !== person);
  } else {
    entry.skips.push(person);
    entry.items = entry.items.filter(it => it.by !== person); // clear this person's own picks when skipping
  }
  entry.time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  if(entry.items.length === 0 && entry.skips.length === 0) delete state.data.selections[day][mealkey];
  else state.data.selections[day][mealkey] = entry;
  render();
  saveData();
}

// clears only the current person's own picks/skip for this meal — leaves the other person's choice untouched
function clearItem(day, mealkey){
  const person = state.role;
  const entry = state.data.selections[day] && state.data.selections[day][mealkey];
  if(!entry) return;
  entry.items = (entry.items || []).filter(it => it.by !== person);
  entry.skips = (entry.skips || []).filter(p => p !== person);
  if(entry.items.length === 0 && entry.skips.length === 0) delete state.data.selections[day][mealkey];
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

function isProtectedItem(mealKey, type, item){
  if(!MENU_DATA[mealKey]) return false;
  const meal = MEALS.find(m=>m.key===mealKey);
  const list = meal.mode === 'flat' ? MENU_DATA[mealKey] : (MENU_DATA[mealKey][type] || []);
  return list.includes(item);
}

function delMenuItem(mealKey, type, idx){
  const meal = MEALS.find(m=>m.key===mealKey);
  const list = meal.mode === 'flat' ? state.data.menu[mealKey] : state.data.menu[mealKey][type];
  const item = list[idx];
  if(isProtectedItem(mealKey, type, item)) return; // built-in dishes can't be removed
  list.splice(idx,1);
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
  const showKhyati = state.data.khyatiHome;
  return `
  <div class="roleswitch">
    <button data-role="dad" class="${state.role==='dad'?'active':''}">👨 Dad</button>
    ${showKhyati ? `<button data-role="khyati" class="${state.role==='khyati'?'active':''}">👧 Khyati</button>` : ''}
    <button data-role="mom" class="${state.role==='mom'?'active':''}">👩 Mom</button>
  </div>`;
}

function renderHomeToggle(){
  const on = state.data.khyatiHome;
  return `
  <div class="hometoggle-wrap">
    <label class="hometoggle">
      <input type="checkbox" id="khyatiHomeToggle" ${on ? 'checked' : ''}>
      <span class="toggletrack"><span class="togglethumb"></span></span>
    </label>
    <span class="hometogglelabel">🏠 Khyati is home${on ? ' — her profile is unlocked' : ''}</span>
  </div>`;
}

function renderDayTabs(){
  const dates = getWeekDates();
  const todayKey = dateKey(new Date());
  const rangeStart = dates[0], rangeEnd = dates[6];
  const sameMonth = rangeStart.getMonth() === rangeEnd.getMonth();
  const weekLabel = sameMonth
    ? `${rangeStart.toLocaleDateString('en-US',{month:'short'})} ${rangeStart.getDate()}–${rangeEnd.getDate()}`
    : `${rangeStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${rangeEnd.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  return `
  <div class="weeknav">
    <button id="prevWeek" class="weeknavbtn">‹</button>
    <div class="weeklabel" id="jumpToday" title="Jump to this week">${weekLabel}</div>
    <button id="nextWeek" class="weeknavbtn">›</button>
  </div>
  <div class="daytabs">
    ${dates.map(d=>{
      const key = dateKey(d);
      const fasting = isFastingDay(d) && showsFasting();
      return `<button data-day="${key}" class="${state.day===key?'active':''} ${key===todayKey?'istoday':''} ${fasting?'fastday':''}">
        <span class="dname">${DAY_ABBR[d.getDay()]}</span><span class="dnum">${d.getDate()}</span>
      </button>`;
    }).join('')}
  </div>`;
}

// veg/nonveg get their own color; anything else (a section name, or nothing) is neutral
function slipClassFor(it){
  return (it.type === 'veg' || it.type === 'nonveg') ? it.type : 'plain';
}
function slipTagFor(it){
  return (it.type && it.type !== 'veg' && it.type !== 'nonveg') ? it.type : null;
}

// read-only summary of one person's status for a meal — used to show "the other person's" choice,
// and used twice (once per person) on Mom's screen
function renderPersonStatus(person, entry){
  const label = OWNER_LABELS[person];
  if(personSkipped(entry, person)){
    return `<div class="personblock skip">🚫 ${label} isn't eating this</div>`;
  }
  const items = personPicks(entry, person);
  if(items.length){
    return `<div class="personblock">
      <div class="personlabel">${label}</div>
      ${items.map(it => `
        <div class="slip ${slipClassFor(it)}">
          <div class="dot"></div>
          <div class="item">${slipTagFor(it) ? `<span class="cattag">${slipTagFor(it)}</span>` : ''}${it.item}</div>
        </div>
      `).join('')}
    </div>`;
  }
  return `<div class="personblock empty">${label} hasn't picked yet</div>`;
}

function renderMealCardDad(meal){
  const entry = selEntry(state.day, meal.key);
  const other = otherEditor();
  const showOther = state.data.khyatiHome; // only show the other person's status when her profile is unlocked
  const skipped = personSkipped(entry, state.role);
  const items = personPicks(entry, state.role);

  const ownSection = skipped ? `
      <div class="skipcard" data-open="${meal.key}">🚫 Not eating ${meal.label.toLowerCase()} today<span class="skipsub">tap to change</span></div>
    ` : items.length ? `
      <div class="selected-items clickable" data-open="${meal.key}">
        ${items.map(it => `
          <div class="slip ${slipClassFor(it)}">
            <div class="dot"></div>
            <div class="item">${slipTagFor(it) ? `<span class="cattag">${slipTagFor(it)}</span>` : ''}${it.item}</div>
          </div>
        `).join('')}
        <div class="stamp-row">tap to edit</div>
      </div>
    ` : `
      <div class="slot-empty" data-open="${meal.key}">+ Choose your own ${meal.label.toLowerCase()}</div>
    `;

  return `
  <div class="meal-card">
    <div class="meal-head">
      <div class="meal-name">${meal.label}</div>
      <div class="meal-time">${meal.time}</div>
    </div>
    ${showOther ? renderPersonStatus(other, entry) : ''}
    ${showOther ? `<div class="owndivider"></div>` : ''}
    ${ownSection}
  </div>`;
}

function renderMealCardMom(meal){
  const entry = selEntry(state.day, meal.key);
  const khyatiActive = state.data.khyatiHome;
  const dadEmpty = !personSkipped(entry,'dad') && personPicks(entry,'dad').length===0;
  const khyatiEmpty = !personSkipped(entry,'khyati') && personPicks(entry,'khyati').length===0;

  let body;
  if(!khyatiActive){
    body = dadEmpty
      ? `<div class="waiting"><span class="bell">🔔</span> Waiting for Dad to choose…</div>`
      : renderPersonStatus('dad', entry);
  } else {
    body = (dadEmpty && khyatiEmpty)
      ? `<div class="waiting"><span class="bell">🔔</span> Waiting for Dad or Khyati to choose…</div>`
      : `${renderPersonStatus('dad', entry)}${renderPersonStatus('khyati', entry)}`;
  }

  return `
  <div class="meal-card">
    <div class="meal-head">
      <div class="meal-name">${meal.label}</div>
      <div class="meal-time">${meal.time}</div>
    </div>
    ${body}
  </div>`;
}

function renderPicker(){
  if(!state.picker) return '';
  const mealkey = state.picker;
  const meal = MEALS.find(m=>m.key===mealkey);
  const entry = selEntry(state.day, mealkey);
  const isSkipped = personSkipped(entry, state.role);
  const ownItemCount = personPicks(entry, state.role).length;

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

  const pickingBody = `
      ${selectorHtml}
      <div class="menulist">
        ${list.map((item,idx)=>{
          const typeVal = meal.mode === 'flat' ? null : state.pickType;
          const picked = isItemSelected(state.day, mealkey, item, typeVal);
          const protectedItem = isProtectedItem(mealkey, typeVal, item);
          return `
          <div class="menuitem ${picked ? 'selected' : ''}" data-pick="${idx}">
            <span>${picked ? '✓ ' : ''}${item}</span>
            ${protectedItem ? '' : `<span class="del" data-del="${idx}">✕</span>`}
          </div>`;
        }).join('') || '<div style="color:var(--ink-soft);font-size:13px;padding:8px 2px;">No items yet — add one below.</div>'}
      </div>
      <div class="addrow">
        <input id="addInput" placeholder="Add a new dish…" value="${state.addText}">
        <button id="addBtn">Add</button>
      </div>
      ${ownItemCount ? `<div style="margin-top:12px;text-align:center;"><button id="clearSel" style="background:none;border:none;color:var(--terracotta);font-size:13px;cursor:pointer;text-decoration:underline;">Clear all selections for this meal</button></div>` : ''}
  `;

  return `
  <div class="overlay" id="overlay">
    <div class="sheet">
      <div class="sheet-head">
        <h2>${meal.label} — ${formatDateLabel(parseDateKey(state.day))}</h2>
        <button id="closeSheet">✕</button>
      </div>
      <div class="pickerowner">Choosing for ${OWNER_LABELS[state.role]}</div>
      <button id="skipToggle" class="skiptoggle ${isSkipped ? 'active' : ''}">${isSkipped ? '↩️ Undo — pick food for this meal instead' : '🚫 Not eating this meal today'}</button>
      ${isSkipped ? `<div class="skipnote">Marked as skipped. Tap "Undo" above to choose food instead.</div>` : pickingBody}
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
        <div class="sub">${state.data.khyatiHome ? 'Dad and Khyati pick. Mom sees it instantly.' : 'Dad picks. Mom sees it instantly.'}</div>
      </div>
      ${renderHomeToggle()}
      ${renderRoleSwitch()}
      <div class="footnote">Choose who you are to get started. Everyone should open this same page — whatever's picked appears on Mom's screen right away, no calls needed.</div>
    `;
    bindGlobal();
    return;
  }

  const cards = MEALS.map(m => isEditorRole() ? renderMealCardDad(m) : renderMealCardMom(m)).join('');
  const fasting = isFastingDay(parseDateKey(state.day)) && showsFasting();
  const momSub = state.data.khyatiHome ? "Today's menu, picked by Dad or Khyati" : "Today's menu, picked by Dad";

  app.innerHTML = `
    <div class="masthead">
      <div class="eyebrow">Home Kitchen</div>
      <h1>What's Cooking?</h1>
      <div class="sub">${isEditorRole() ? 'Pick a dish for each meal' : momSub}</div>
    </div>
    ${renderHomeToggle()}
    ${renderDayTabs()}
    ${fasting ? `<div class="fastbanner">🌙 Fasting day — usually just one full meal</div>` : ''}
    ${cards}
    ${state.role==='mom' ? `<div class="footnote">This screen updates on its own every few seconds.</div>` : `<div class="footnote">Tap a meal to choose from the menu, or add a new dish while you're there.</div>`}
    ${isEditorRole() ? `<div class="clearweek"><button id="clearWeekBtn">Clear all picks for this week</button></div>` : ''}
    <div class="switchuser"><button id="switchRole">Not ${ROLE_LABELS[state.role]}? Switch user</button></div>
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

  const khyatiHomeToggle = document.getElementById('khyatiHomeToggle');
  if(khyatiHomeToggle){
    khyatiHomeToggle.onchange = (e)=>{
      state.data.khyatiHome = e.target.checked;
      if(!state.data.khyatiHome && state.role === 'khyati'){
        state.role = null; // she just got marked away — send this device back to the role screen
      }
      render();
      saveData();
    };
  }

  app.querySelectorAll('[data-day]').forEach(b=>{
    b.onclick = ()=>{ state.day = b.dataset.day; render(); };
  });

  const prevWeekBtn = document.getElementById('prevWeek');
  if(prevWeekBtn) prevWeekBtn.onclick = ()=>{ shiftWeek(-7); };
  const nextWeekBtn = document.getElementById('nextWeek');
  if(nextWeekBtn) nextWeekBtn.onclick = ()=>{ shiftWeek(7); };
  const jumpTodayEl = document.getElementById('jumpToday');
  if(jumpTodayEl) jumpTodayEl.onclick = jumpToToday;

  const clearWeekBtn = document.getElementById('clearWeekBtn');
  if(clearWeekBtn) clearWeekBtn.onclick = clearWeek;

  app.querySelectorAll('[data-open]').forEach(b=>{
    b.onclick = ()=>{
      state.picker = b.dataset.open;
      const meal = MEALS.find(m=>m.key===state.picker);
      const entry = selEntry(state.day, state.picker);
      const ownItems = personPicks(entry, state.role);
      const lastType = ownItems.length ? ownItems[ownItems.length-1].type : null;
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
  if(doneBtn) doneBtn.onclick = ()=>{
    const day = state.day, mealkey = state.picker, person = state.role;
    const entry = selEntry(day, mealkey);
    const madeChoice = personSkipped(entry, person) || personPicks(entry, person).length > 0;
    state.picker = null;
    render();
    if(madeChoice) showToast('✅ Choice submitted!');
  };
  const overlay = document.getElementById('overlay');
  if(overlay) overlay.onclick = (e)=>{ if(e.target===overlay){ state.picker=null; render(); } };

  const skipToggle = document.getElementById('skipToggle');
  if(skipToggle) skipToggle.onclick = ()=>{ toggleSkip(state.day, state.picker); };

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

render();       // show the landing screen immediately, don't wait on the network
startSync();    // then start listening for live updates from Firebase

// register the service worker so the app can be "installed" as a home-screen icon
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{ /* not critical if this fails */ });
}