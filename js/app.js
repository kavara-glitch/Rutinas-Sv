// ============================================================
// DATABASE
// ============================================================
let currentUser = null;
let currentFilter = 'all';
let currentTipFilter = 'all';
let currentExpenseFilter = 'all';
let currentPlanType = 'daily';
let cameraStream = null;
let currentFacingMode = 'environment';
let capturedTicketData = null;
let notifHistory = [];
let tipsReadCount = 0;
let breathInterval = null;
let syncChannel = null;
let stateImageData = null;

// ====== ESTADO DM / VIDEOLLAMADA ======
let activeDmPeerId = null; // legado, ya no se usa: el enrutamiento ahora es por convId de rutina
let activeCall = null;
let incomingCallData = null;
let stateCameraStream = null;
let stateCameraFacing = 'user';
let stateCameraReady = false;
let stateCapturing = false;

function getDB() { return JSON.parse(localStorage.getItem('rutinasSvDB_v2') || '{"users":[],"tasks":[],"expenses":[],"settings":{},"achievements":[],"habits":{},"plans":[],"globalChat":[],"states":[],"dmConversations":{},"dmMessages":{},"gardenTrail":[]}'); }
function saveDB(db) { localStorage.setItem('rutinasSvDB_v2', JSON.stringify(db)); syncBroadcast('db_updated'); }
function getTasks() { return (getDB().tasks||[]).filter(t => t.userId === currentUser?.id); }
function saveTasks(tasks) { const db = getDB(); db.tasks = [...(db.tasks||[]).filter(t => t.userId !== currentUser.id), ...tasks]; saveDB(db); }
function getExpenses() { return (getDB().expenses||[]).filter(e => e.userId === currentUser?.id); }
function saveExpenses(expenses) { const db = getDB(); db.expenses = [...(db.expenses||[]).filter(e => e.userId !== currentUser.id), ...expenses]; saveDB(db); }
function getHabits() { const db = getDB(); return db.habits || {}; }
function saveHabits(habits) { const db = getDB(); db.habits = habits; saveDB(db); }
function getWalletLimit() {
const db = getDB();
const userBudget = db.users ? (db.users.find(u => u.id === (currentUser && currentUser.id)) || {}).budget : null;
return (userBudget && userBudget > 0) ? userBudget : 0;
}
function setWalletLimit(amount) {
const db = getDB();
if (!db.users) db.users = [];
const idx = db.users.findIndex(u => u.id === currentUser.id);
if (idx > -1) { db.users[idx].budget = amount; }
else { db.users.push({ ...currentUser, budget: amount }); }
saveDB(db);
updateWallet();
showToast('💰 Presupuesto actualizado: $' + amount.toFixed(2), 'success');
}

// ============================================================
// XP & ACHIEVEMENTS
// ============================================================
const LEVELS = [
{ level: 1, name: 'Principiante', xp: 0, icon: '🌱' },
{ level: 2, name: 'Explorador', xp: 100, icon: '🌿' },
{ level: 3, name: 'Organizado', xp: 250, icon: '📋' },
{ level: 4, name: 'Productivo', xp: 500, icon: '⚡' },
{ level: 5, name: 'Eficiente', xp: 800, icon: '🎯' },
{ level: 6, name: 'Maestro', xp: 1200, icon: '🏆' },
{ level: 7, name: 'Experto', xp: 1800, icon: '💎' },
{ level: 8, name: 'Leyenda', xp: 2500, icon: '👑' },
{ level: 9, name: 'Mítico', xp: 3500, icon: '🌟' },
{ level: 10, name: 'Supremo', xp: 5000, icon: '🔥' }
];
const ACHIEVEMENTS = [
{ id: 'first_task', name: 'Primer Paso', desc: 'Completa tu primera tarea', icon: '✅', xp: 25, check: (u,t,e) => t.filter(x=>x.completed).length >= 1 },
{ id: 'five_tasks', name: 'En Racha', desc: 'Completa 5 tareas', icon: '📋', xp: 50, check: (u,t,e) => t.filter(x=>x.completed).length >= 5 },
{ id: 'ten_tasks', name: 'Productivo', desc: 'Completa 10 tareas', icon: '⚡', xp: 100, check: (u,t,e) => t.filter(x=>x.completed).length >= 10 },
{ id: 'twenty_five', name: 'Máquina', desc: 'Completa 25 tareas', icon: '🤖', xp: 200, check: (u,t,e) => t.filter(x=>x.completed).length >= 25 },
{ id: 'fifty_tasks', name: 'Imparable', desc: 'Completa 50 tareas', icon: '🚀', xp: 500, check: (u,t,e) => t.filter(x=>x.completed).length >= 50 },
{ id: 'streak_3', name: 'Constancia', desc: '3 días de racha', icon: '🔥', xp: 75, check: (u,t,e) => getStreak() >= 3 },
{ id: 'streak_7', name: 'Semana Perfecta', desc: '7 días de racha', icon: '📅', xp: 150, check: (u,t,e) => getStreak() >= 7 },
{ id: 'streak_30', name: 'Mes Completo', desc: '30 días de racha', icon: '🏆', xp: 500, check: (u,t,e) => getStreak() >= 30 },
{ id: 'ai_chat', name: 'Curioso', desc: 'Envía 10 mensajes a la IA', icon: '🤖', xp: 50, check: (u,t,e) => (getHabits().aiMessages||0) >= 10 },
{ id: 'time_manager', name: 'Estratega', desc: 'Pide una sugerencia al Gestor de Tiempo', icon: '⏱️', xp: 50, check: (u,t,e) => (getHabits().timeManagerUsed||false) },
{ id: 'all_categories', name: 'Versátil', desc: 'Tareas en 4+ categorías', icon: '🎭', xp: 100, check: (u,t,e) => new Set(t.map(x=>x.category)).size >= 4 },
{ id: 'level_5', name: 'Nivel 5', desc: 'Alcanza el nivel 5', icon: '💎', xp: 200, check: (u,t,e) => getUserLevel().level >= 5 },
{ id: 'relax_mode', name: 'Zen', desc: 'Usa el modo relajante', icon: '🧘', xp: 25, check: (u,t,e) => (getHabits().relaxUsed||false) },
{ id: 'export_data', name: 'Backup', desc: 'Exporta tus datos', icon: '💾', xp: 25, check: (u,t,e) => (getHabits().dataExported||false) },
{ id: 'night_owl', name: 'Noctámbulo', desc: 'Completa una tarea después de las 10pm', icon: '🦉', xp: 50, check: (u,t,e) => t.some(x => x.completed && x.completedAt && new Date(x.completedAt).getHours() >= 22) },
{ id: 'state_publisher', name: 'Influencer', desc: 'Publica 5 estados', icon: '📸', xp: 75, check: (u,t,e) => (getHabits().statesPublished||0) >= 5 },
{ id: 'jardinero', name: 'Jardinero', desc: 'Haz florecer 4 categorías del Jardín', icon: '🪴', xp: 150, check: (u,t,e) => gardenBloomingCount() >= 4 },
{ id: 'dm_first', name: 'Conectado', desc: 'Envía tu primer mensaje en una rutina compartida', icon: '🌱', xp: 50, check: (u,t,e) => (getHabits().dmMessages||0) >= 1 },
{ id: 'video_call', name: 'Cara a Cara', desc: 'Enciende tu primera fogata (llamada) con alguien', icon: '🔥', xp: 100, check: (u,t,e) => (getHabits().videoCalls||0) >= 1 },
{ id: 'admin_exclusive_1', name: 'Guardián del Sistema', desc: 'Logro exclusivo para administradores.', icon: '👑', xp: 500, adminOnly: true, check: (u,t,e) => u && (u.role === 'admin' || u.role === 'boss') },
{ id: 'admin_exclusive_2', name: 'Corona Suprema', desc: 'Logro exclusivo para el jefe supremo.', icon: '👑', xp: 1000, adminOnly: true, requireRole: 'boss', check: (u,t,e) => u && u.role === 'boss' },
{ id: 'veteran_5years', name: 'Veterano Legendario', desc: '5 años completos en Rutinas-Sv.', icon: '🏛️', xp: 2000, check: (u,t,e) => {
if (!u || !u.createdAt) return false;
const created = new Date(u.createdAt);
const now = new Date();
const yearsDiff = (now - created) / (1000 * 60 * 60 * 24 * 365.25);
if (yearsDiff < 5) return false;
const habits = getHabits();
const dailyCount = Object.keys(habits.daily || {}).length;
const achievements = (getDB().achievements || []).length;
return dailyCount >= 100 || achievements >= 10;
}}
];
function getUserXP() { const db = getDB(); return (db.settings||{}).xp || 0; }
function addXP(amount, reason) {
const db = getDB();
if (!db.settings) db.settings = {};
db.settings.xp = (db.settings.xp || 0) + amount;
saveDB(db);
const level = getUserLevel();
showToast(`+${amount} XP ${reason || ''} (Nivel ${level.level})`, 'xp');
checkAchievements();
updateXPUI();
}
function getUserLevel() {
const xp = getUserXP();
let level = LEVELS[0];
for (let i = LEVELS.length - 1; i >= 0; i--) { if (xp >= LEVELS[i].xp) { level = LEVELS[i]; break; } }
const nextLevel = LEVELS[level.level] || null;
const currentXP = level.xp;
const needed = nextLevel ? nextLevel.xp - currentXP : 1;
const progress = nextLevel ? ((xp - currentXP) / needed) * 100 : 100;
return { level: level.level, name: level.name, icon: level.icon, xp, progress, currentXP, nextXP: nextLevel?.xp || xp, needed };
}
function getStreak() {
const habits = getHabits();
const streakData = habits.streak || { count: 0, lastDate: null };
const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
if (streakData.lastDate === today) return streakData.count;
if (streakData.lastDate === yesterday) return streakData.count;
if (streakData.lastDate && streakData.lastDate !== today) return 0;
return streakData.count;
}
function updateStreak() {
const habits = getHabits();
const today = new Date().toISOString().split('T')[0];
if (!habits.streak) habits.streak = { count: 0, lastDate: null };
if (habits.streak.lastDate === today) return;
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
if (habits.streak.lastDate === yesterday || habits.streak.lastDate === null) { habits.streak.count++; } else { habits.streak.count = 1; }
habits.streak.lastDate = today;
if (!habits.daily) habits.daily = {};
const tasks = getTasks();
const completedToday = tasks.filter(t => t.completed && t.completedAt && t.completedAt.startsWith(today)).length;
habits.daily[today] = completedToday;
saveHabits(habits);
}
function checkAchievements() {
const db = getDB();
if (!db.achievements) db.achievements = [];
const tasks = getTasks();
const expenses = getExpenses();
ACHIEVEMENTS.forEach(ach => {
if (ach.adminOnly && (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'boss'))) return;
if (ach.requireRole && currentUser && currentUser.role !== ach.requireRole) return;
if (!db.achievements.includes(ach.id) && ach.check(currentUser, tasks, expenses)) {
db.achievements.push(ach.id);
saveDB(db);
showToast(`🏆 ¡Logro desbloqueado: ${ach.name}! +${ach.xp} XP`, 'achievement');
addXP(ach.xp, `🏆 ${ach.name}`);
showConfetti();
}
});
}
function showConfetti() {
for (let i = 0; i < 20; i++) {
const piece = document.createElement('div');
piece.className = 'confetti-piece';
piece.style.left = Math.random() * 100 + 'vw';
piece.style.top = Math.random() * 50 + 30 + 'vh';
piece.style.background = ['#e9c46a','#f4a261','#52b788','#e76f51','#4cc9f0','#f72585'][Math.floor(Math.random()*6)];
piece.style.animationDuration = (1 + Math.random()) + 's';
piece.style.animationDelay = Math.random() * 0.5 + 's';
document.body.appendChild(piece);
setTimeout(() => piece.remove(), 2500);
}
}
function updateXPUI() {
const level = getUserLevel();
document.getElementById('xpMiniLevel').textContent = level.icon + level.level;
document.getElementById('xpMiniBar').style.width = level.progress + '%';
document.getElementById('xpMiniText').textContent = level.xp + ' XP';
}
function renderAchievements() {
const db = getDB();
const unlocked = db.achievements || [];
const level = getUserLevel();
document.getElementById('levelDisplay').innerHTML = `
<div class="level-avatar">${level.icon}</div>
<div class="level-info">
<h3>Nivel ${level.level} — ${level.name}</h3>
<div class="level-name">${level.icon} ${level.name}</div>
<div class="level-xp-bar"><div class="level-xp-fill" style="width:${level.progress}%"></div></div>
<div class="level-xp-text">${level.xp} / ${level.nextXP} XP (${level.needed} para siguiente nivel)</div>
</div>`;
const visibleAchievements = ACHIEVEMENTS.filter(ach => {
if (ach.adminOnly && (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'boss'))) return false;
if (ach.requireRole && currentUser && currentUser.role !== ach.requireRole) return false;
return true;
});
document.getElementById('achievementCount').textContent = unlocked.filter(id => visibleAchievements.some(a => a.id === id)).length + '/' + visibleAchievements.length;
document.getElementById('achievementsGrid').innerHTML = visibleAchievements.map(ach => {
const isUnlocked = unlocked.includes(ach.id);
const adminClass = ach.adminOnly ? 'achievement-admin-only' : '';
return `<div class="achievement-card ${isUnlocked?'unlocked':'locked'} ${adminClass}">
<div class="achievement-icon">${ach.icon}</div>
<div class="achievement-name">${ach.name}</div>
<div class="achievement-desc">${ach.desc}</div>
<div class="achievement-xp">${isUnlocked ? '✅ +' + ach.xp + ' XP' : '🔒 ' + ach.xp + ' XP'}</div>
</div>`;
}).join('');
renderShowcaseSelector();
}
function renderShowcaseSelector() {
const db = getDB();
const unlocked = db.achievements || [];
const userShowcase = currentUser?.showcaseAchievements || [];
const container = document.getElementById('showcaseSelector');
if (!container) return;
const unlockedAchs = ACHIEVEMENTS.filter(ach => {
if (ach.adminOnly && (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'boss'))) return false;
if (ach.requireRole && currentUser && currentUser.role !== ach.requireRole) return false;
return unlocked.includes(ach.id);
});
if (unlockedAchs.length === 0) {
container.innerHTML = '<p style="font-size:0.88em;color:var(--text-light);grid-column:1/-1;text-align:center;padding:20px">Desbloquea logros para elegir tu showcase</p>';
return;
}
container.innerHTML = unlockedAchs.map(ach => {
const selected = userShowcase.includes(ach.id);
return `<div class="showcase-option ${selected?'selected':''}" onclick="toggleShowcase('${ach.id}')">
<div class="so-icon">${ach.icon}</div>
<div class="so-name">${ach.name}</div>
</div>`;
}).join('');
}
function toggleShowcase(achId) {
const db = getDB();
if (!currentUser) return;
if (!currentUser.showcaseAchievements) currentUser.showcaseAchievements = [];
const idx = currentUser.showcaseAchievements.indexOf(achId);
if (idx > -1) { currentUser.showcaseAchievements.splice(idx, 1); }
else {
if (currentUser.showcaseAchievements.length >= 3) { showToast('⚠️ Máximo 3 logros', 'warning'); return; }
currentUser.showcaseAchievements.push(achId);
}
const userIdx = db.users.findIndex(u => u.id === currentUser.id);
if (userIdx > -1) { db.users[userIdx].showcaseAchievements = currentUser.showcaseAchievements; saveDB(db); }
renderShowcaseSelector();
renderProfileShowcase();
}
function saveShowcase() { showToast('⭐ Showcase guardado.', 'success'); }
function getUserShowcase(userId) { const db = getDB(); const user = db.users.find(u => u.id === userId); return user?.showcaseAchievements || []; }
function renderUserShowcase(userId, containerId) {
const container = document.getElementById(containerId);
if (!container) return;
const showcase = getUserShowcase(userId);
const icons = showcase.slice(0, 3).map(id => { const ach = ACHIEVEMENTS.find(a => a.id === id); return ach ? `<span class="showcase-ach" title="${ach.name}">${ach.icon}</span>` : ''; }).join('');
const streak = userId === currentUser?.id ? getStreak() : 0;
container.innerHTML = `${icons}<span class="streak-badge">🔥 ${streak}d</span>`;
}
function renderProfileShowcase() { if (currentUser) renderUserShowcase(currentUser.id, 'profileShowcase'); }

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
const db = getDB();
if (!db.users.find(u => u.role === 'boss')) { db.users.push({ id:'boss_default', email:'ceo@rutinas-sv.com', username:'CEO', password:'7710', role:'boss', createdAt:new Date().toISOString() }); saveDB(db); }
if (!db.users.find(u => u.role === 'admin' && u.username === 'Admin')) { db.users.push({ id:'admin_default', email:'admin@rutinas-sv.com', username:'Admin', password:'7777', role:'admin', createdAt:new Date().toISOString() }); saveDB(db); }
document.getElementById('taskDate').value = new Date().toISOString().split('T')[0];
initThemes();
initTips();
initLiveChat();
try {
syncChannel = new BroadcastChannel('rutinas_sv_sync');
syncChannel.onmessage = (e) => { if (e.data.type === 'db_updated' && currentUser) { showApp(); } };
} catch(e) {}
const session = localStorage.getItem('rutinasSvSession');
if (session) {
try {
const user = JSON.parse(session);
const found = db.users.find(u => u.id === user.id);
if (found) { currentUser = found; setTimeout(() => { showApp(); }, 300); }
} catch(e) { localStorage.removeItem('rutinasSvSession'); }
}
setInterval(() => {
if (currentUser && document.getElementById('page-privatechats')?.classList.contains('active')) {
if (document.getElementById('rcTabActive')?.classList.contains('active')) RoutineChatOrbital.refresh(); else renderArchivedRoutineChats();
}
if (currentUser && activeCapsule) renderCapsuleMessages();
updateDmBadge();
}, 4000);
});
function syncBroadcast(type) { if (syncChannel) { try { syncChannel.postMessage({ type, timestamp: Date.now() }); } catch(e) {} } }

// ============================================================
// AUTH
// ============================================================
let selectedRole = 'user';
function switchAuthTab(tab) {
document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
if (tab === 'login') { document.querySelectorAll('.auth-tab')[0].classList.add('active'); document.getElementById('loginForm').style.display = 'block'; document.getElementById('registerForm').style.display = 'none'; }
else { document.querySelectorAll('.auth-tab')[1].classList.add('active'); document.getElementById('loginForm').style.display = 'none'; document.getElementById('registerForm').style.display = 'block'; }
hideAuthMessages();
}
function selectRole(role, btn) { selectedRole = role; document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); document.getElementById('regAdminPass').style.display = (role==='admin'||role==='boss')?'block':'none'; }
function showAuthError(m) { const el = document.getElementById('authError'); el.textContent = m; el.style.display = 'block'; document.getElementById('authSuccess').style.display = 'none'; }
function showAuthSuccess(m) { const el = document.getElementById('authSuccess'); el.textContent = m; el.style.display = 'block'; document.getElementById('authError').style.display = 'none'; }
function hideAuthMessages() { document.getElementById('authError').style.display = 'none'; document.getElementById('authSuccess').style.display = 'none'; }
// ============================================================
// SEGURIDAD: hashing de contraseñas (SHA-256 + sal) y edad
// ============================================================
async function sha256Hex(str) {
const enc = new TextEncoder().encode(str);
const buf = await crypto.subtle.digest('SHA-256', enc);
return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function genSalt() {
const arr = new Uint8Array(16);
crypto.getRandomValues(arr);
return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function hashPassword(password, salt) { return await sha256Hex(salt + ':' + password); }
function computeAgeFromBirthdate(birthdateStr) {
if (!birthdateStr) return null;
const b = new Date(birthdateStr + 'T00:00:00');
if (isNaN(b.getTime())) return null;
const now = new Date();
let age = now.getFullYear() - b.getFullYear();
const m = now.getMonth() - b.getMonth();
if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
return age;
}
function openLegalModal() { document.getElementById('legalModal').classList.add('show'); }
function renderSettingsAgeBadge() {
const el = document.getElementById('settingsAgeBadge');
if (!el || !currentUser) return;
if (!currentUser.birthdate) { el.innerHTML = '<span class="chip">🎂 Sin fecha de nacimiento registrada (cuenta creada antes de esta actualización)</span>'; return; }
const age = computeAgeFromBirthdate(currentUser.birthdate);
if (age === null) { el.innerHTML = ''; return; }
el.innerHTML = age < 18
? `<span class="chip">🎂 ${age} años · cuenta menor de edad, se recomienda supervisión</span>`
: `<span class="chip">🎂 ${age} años · cuenta verificada como mayor de 18</span>`;
}

async function login() {
const email = document.getElementById('loginEmail').value.trim();
const username = document.getElementById('loginUsername').value.trim();
const password = document.getElementById('loginPassword').value;
if (!email || !username || !password) { showAuthError('Completa todos los campos'); return; }
const db = getDB();
const user = db.users.find(u => u.email === email && u.username === username);
if (!user) { showAuthError('Credenciales incorrectas'); return; }
let ok = false;
if (user.passwordHash && user.passwordSalt) {
ok = (await hashPassword(password, user.passwordSalt)) === user.passwordHash;
} else if (user.password !== undefined) {
// cuenta antigua con contraseña en texto plano: verificamos y la migramos a hash
ok = user.password === password;
if (ok) { const salt = genSalt(); user.passwordHash = await hashPassword(password, salt); user.passwordSalt = salt; delete user.password; saveDB(db); }
}
if (!ok) { showAuthError('Credenciales incorrectas'); return; }
currentUser = user;
localStorage.setItem('rutinasSvSession', JSON.stringify(user));
hideAuthMessages(); showApp();
showToast('¡Bienvenido, ' + user.username + '! 🌿', 'success');
}
async function register() {
const email = document.getElementById('regEmail').value.trim();
const username = document.getElementById('regUsername').value.trim();
const birthdate = document.getElementById('regBirthdate').value;
const password = document.getElementById('regPassword').value;
const passwordConfirm = document.getElementById('regPasswordConfirm').value;
if (!email || !username || !password || !birthdate) { showAuthError('Completa todos los campos, incluida tu fecha de nacimiento'); return; }
if (password !== passwordConfirm) { showAuthError('Las contraseñas no coinciden'); return; }
if (password.length < 4) { showAuthError('Mínimo 4 caracteres'); return; }
const age = computeAgeFromBirthdate(birthdate);
if (age === null) { showAuthError('Fecha de nacimiento inválida'); return; }
if (age > 120) { showAuthError('Revisa la fecha de nacimiento ingresada'); return; }
if (age < 13) { showAuthError('🔞 Debes tener al menos 13 años para crear una cuenta en Rutinas-SV'); return; }
if (!document.getElementById('regAcceptTerms').checked) { showAuthError('Debes aceptar el Aviso Legal y de Privacidad para continuar'); return; }
if (selectedRole === 'admin' && document.getElementById('regAdminPassword').value !== '7777') { showAuthError('Contraseña de admin incorrecta'); return; }
if (selectedRole === 'boss' && document.getElementById('regAdminPassword').value !== '7710') { showAuthError('Contraseña de CEO incorrecta'); return; }
const db = getDB();
if (db.users.find(u => u.email === email || u.username === username)) { showAuthError('Correo o usuario ya existe'); return; }
const gender = document.getElementById('regGender').value;
const salt = genSalt();
const passwordHash = await hashPassword(password, salt);
db.users.push({ id: 'user_' + Date.now(), email, username, passwordHash, passwordSalt: salt, birthdate, isMinor: age < 18, gender, role: selectedRole, createdAt: new Date().toISOString(), acceptedTermsAt: new Date().toISOString(), showcaseAchievements: [] });
saveDB(db);
showAuthSuccess('✅ Cuenta creada. Inicia sesión.');
setTimeout(() => switchAuthTab('login'), 1500);
}
function logout() { stopCamera(); stopAllRelaxSounds(); stopStateCamera(); hangupCall(); currentUser = null; localStorage.removeItem('rutinasSvSession'); document.getElementById('appScreen').style.display = 'none'; document.getElementById('authScreen').style.display = 'flex'; hideAuthMessages(); }

// ============================================================
// NAVIGATION
// ============================================================
function showApp() {
document.getElementById('authScreen').style.display = 'none';
document.getElementById('appScreen').style.display = 'block';
document.getElementById('headerAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
document.getElementById('profileAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
document.getElementById('profileName').textContent = currentUser.username;
document.getElementById('profileEmail').textContent = currentUser.email;
const roleNames = { boss: '👑 CEO', admin: '🛡️ Administrador', user: '👤 Usuario' };
document.getElementById('profileRole').textContent = roleNames[currentUser.role] || 'Usuario';
const genderLabels = { hombre: '♂ Hombre', mujer: '♀ Mujer', otro: '⚧ Otro' };
document.getElementById('profileGender').textContent = genderLabels[currentUser.gender] || '';
if (currentUser.role === 'admin' || currentUser.role === 'boss') {
document.getElementById('adminMenuItem').style.display = 'flex';
document.getElementById('sidebarAdminSection').style.display = 'block';
document.getElementById('sidebarAdminItem').style.display = 'flex';
document.getElementById('adminTitle').textContent = currentUser.role === 'boss' ? '👑 Panel del CEO' : '🛡️ Panel Admin';
} else {
document.getElementById('adminMenuItem').style.display = 'none';
document.getElementById('sidebarAdminSection').style.display = 'none';
document.getElementById('sidebarAdminItem').style.display = 'none';
}
const settings = getDB().settings || {};
if (settings.theme) applyTheme(settings.theme);
if (settings.darkMode) { document.documentElement.setAttribute('data-darkmode', 'true'); document.getElementById('darkModeCornerBtn').classList.add('active'); document.getElementById('darkModeCornerBtn').textContent = '☀️'; }
if (settings.customColors) applyCustomColorsFromSettings(settings.customColors);
updateDashboard(); renderTasks(); updateXPUI();
renderProfileShowcase();
if (currentUser.role === 'admin' || currentUser.role === 'boss') renderAdminPanel();
if ('Notification' in window) Notification.requestPermission();
navigateTo('dashboard');
updateDmBadge();
}
function navigateTo(page) {
if (page === 'admin' && !(currentUser && (currentUser.role === 'admin' || currentUser.role === 'boss'))) { showToast('⛔ Acceso restringido', 'error'); page = 'dashboard'; }
document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
const pageEl = document.getElementById('page-' + page);
if (pageEl) pageEl.classList.add('active');
const si = document.querySelector(`.sidebar-item[data-page="${page}"]`);
if (si) si.classList.add('active');
document.getElementById('sidebar').classList.remove('open');
document.getElementById('sidebarOverlay').classList.remove('show');
document.getElementById('userDropdown').classList.remove('show');
if (page === 'dashboard') { updateDashboard(); renderDashboardAiSuggestions(); }
if (page === 'garden') renderGarden();
if (page === 'states') renderStates();
if (page === 'tasks') renderTasks();
if (page === 'achievements') renderAchievements();
if (page === 'profile') { document.getElementById('editUsername').value = currentUser.username; document.getElementById('editEmail').value = currentUser.email; renderProfileShowcase(); }
if (page === 'privatechats') { switchRoutineChatTab('active'); }
if (page === 'ai') { renderAiTokenBar(); }
if (page === 'settings') { renderSettingsAgeBadge(); renderAiProviderSettings(); }
if (page === 'admin') { renderAdminPanel(); }
if (page === 'timemanager') { renderTimeManager(); }
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('show'); }
function toggleUserMenu() { document.getElementById('userDropdown').classList.toggle('show'); }
document.addEventListener('click', e => { if (!e.target.closest('.user-menu')) document.getElementById('userDropdown').classList.remove('show'); });

// ============================================================
// GLOBAL CHAT
// ============================================================
function getGlobalChat() { return getDB().globalChat || []; }
function saveGlobalChat(messages) { const db = getDB(); db.globalChat = messages; saveDB(db); }
function renderGlobalChat() {
const container = document.getElementById('globalChatMessages');
if (!container) return;
updateChatRateWarning();
const messages = getGlobalChat();
const db = getDB();
const lastRead = parseInt(localStorage.getItem('globalChatLastRead') || '0');
const unread = messages.filter(m => m.timestamp > lastRead && m.userId !== currentUser.id).length;
const badge = document.getElementById('chatBadge');
if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'inline' : 'none'; }
if (messages.length === 0) {
container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h3>Sé el primero en saludar</h3></div>';
return;
}
container.innerHTML = messages.map(msg => {
const isOwn = msg.userId === currentUser.id;
const user = db.users.find(u => u.id === msg.userId) || { username: msg.username || 'Desconocido', role: msg.role || 'user' };
const time = new Date(msg.timestamp).toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
const showcase = getUserShowcase(msg.userId);
const showcaseIcons = showcase.slice(0,3).map(id => { const ach = ACHIEVEMENTS.find(a => a.id === id); return ach ? ach.icon : ''; }).join('');
const roleLabels = { boss: '👑 Jefe', admin: '🛡️ Admin', user: '👤' };
const avatarColors = ['#4361ee','#2a9d8f','#e76f51','#7209b7','#e9c46a','#f4a261'];
const colorIdx = msg.userId.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % avatarColors.length;
const canDelete = (currentUser.role === 'admin' || currentUser.role === 'boss') || msg.userId === currentUser.id;
const deleteBtn = canDelete ? `<button class="global-msg-delete" onclick="deleteGlobalMessage('${msg.id}')">🗑️</button>` : '';
return `<div class="global-msg ${isOwn?'own':''}">
<div class="global-msg-avatar" style="background:${avatarColors[colorIdx]}">${user.username.charAt(0).toUpperCase()}</div>
<div class="global-msg-body">
<div class="global-msg-header">
<span class="global-msg-name">${user.username}</span>
<span class="global-msg-role ${user.role}">${roleLabels[user.role]||'👤'}</span>
${showcaseIcons ? `<span style="font-size:0.9em">${showcaseIcons}</span>` : ''}
<span class="global-msg-time">${time}</span>
${deleteBtn}
</div>
<div class="global-msg-bubble">${escapeHtml(msg.text)}</div>
</div>
</div>`;
}).join('');
container.scrollTop = container.scrollHeight;
localStorage.setItem('globalChatLastRead', Date.now().toString());
const newBadge = document.getElementById('chatBadge');
if (newBadge) { newBadge.style.display = 'none'; }
}
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function sendGlobalMessage() {
const input = document.getElementById('globalChatInput');
const text = input.value.trim();
if (!text) return;
const rate = checkChatRateLimit();
if (!rate.allowed) { showToast(`⏳ Espera ${rate.secondsLeft}s`, 'warning'); return; }
const messages = getGlobalChat();
const newMsg = { id: 'msg_' + Date.now() + '_' + Math.random().toString(16).slice(2,8), userId: currentUser.id, username: currentUser.username, role: currentUser.role, text: text, timestamp: Date.now(), type: 'message' };
messages.push(newMsg);
if (messages.length > 200) messages.splice(0, messages.length - 200);
saveGlobalChat(messages);
publishLiveChatMessage(newMsg);
input.value = '';
registerChatMessageSent();
const habits = getHabits();
habits.globalChatMessages = (habits.globalChatMessages || 0) + 1;
saveHabits(habits);
checkAchievements();
renderGlobalChat();
addXP(2, '💬 Mensaje en chat global');
}
const CHAT_RATE_MAX = 5;
const CHAT_RATE_COOLDOWN_MS = 60000;
function checkChatRateLimit() {
if (currentUser.role === 'admin' || currentUser.role === 'boss') return { allowed: true };
const db = getDB();
const user = db.users.find(u => u.id === currentUser.id);
if (!user) return { allowed: true };
const rate = user.chatRate || { count: 0, blockedUntil: 0 };
const now = Date.now();
if (rate.blockedUntil && now < rate.blockedUntil) { return { allowed: false, secondsLeft: Math.ceil((rate.blockedUntil - now) / 1000) }; }
return { allowed: true };
}
function registerChatMessageSent() {
if (currentUser.role === 'admin' || currentUser.role === 'boss') return;
const db = getDB();
const idx = db.users.findIndex(u => u.id === currentUser.id);
if (idx === -1) return;
const now = Date.now();
let rate = db.users[idx].chatRate || { count: 0, blockedUntil: 0 };
if (rate.blockedUntil && now >= rate.blockedUntil) rate = { count: 0, blockedUntil: 0 };
rate.count = (rate.count || 0) + 1;
if (rate.count >= CHAT_RATE_MAX) { rate.blockedUntil = now + CHAT_RATE_COOLDOWN_MS; rate.count = 0; }
db.users[idx].chatRate = rate;
saveDB(db);
updateChatRateWarning();
}
function updateChatRateWarning() {
const el = document.getElementById('chatRateWarning');
const btn = document.querySelector('.global-chat-input button');
const input = document.getElementById('globalChatInput');
if (!el) return;
const rate = checkChatRateLimit();
if (!rate.allowed) {
el.classList.add('show');
el.textContent = `⏳ Espera ${rate.secondsLeft}s`;
if (input) input.disabled = true;
if (btn) btn.disabled = true;
} else {
el.classList.remove('show'); el.textContent = '';
if (input) input.disabled = false;
if (btn) btn.disabled = false;
}
}
function deleteGlobalMessage(msgId) {
const db = getDB();
const msg = (db.globalChat || []).find(m => m.id === msgId);
if (!msg) return;
const canDelete = (currentUser.role === 'admin' || currentUser.role === 'boss') || msg.userId === currentUser.id;
if (!canDelete) { showToast('Solo puedes eliminar tus mensajes', 'error'); return; }
if (!confirm('¿Eliminar este mensaje?')) return;
db.globalChat = (db.globalChat || []).filter(m => m.id !== msgId);
saveDB(db);
publishLiveChatDelete(msgId);
renderGlobalChat();
showToast('🗑️ Mensaje eliminado', 'success');
}

// ============================================================
// LIVE CHAT BRIDGE (MQTT)
// ============================================================
const LIVE_CHAT_TOPIC = 'rutinas-sv-app-2026/global-chat/v1';
const LIVE_DM_TOPIC_PREFIX = 'rutinas-sv-app-2026/dm/v1/';
const LIVE_CALL_TOPIC = 'rutinas-sv-app-2026/calls/v1';
let liveChatClient = null;
let liveChatConnected = false;
let dmSubscribedTopics = new Set();

function initLiveChat() {
if (typeof mqtt === 'undefined') { updateLiveChatStatus('unavailable'); return; }
try {
liveChatClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', { clientId: 'rutinas-sv-' + Math.random().toString(16).slice(2), reconnectPeriod: 4000, connectTimeout: 8000 });
liveChatClient.on('connect', () => {
liveChatConnected = true;
liveChatClient.subscribe(LIVE_CHAT_TOPIC);
liveChatClient.subscribe(LIVE_CALL_TOPIC);
updateLiveChatStatus('connected');
dmSubscribedTopics.forEach(t => { try { liveChatClient.subscribe(t); } catch(e){} });
});
liveChatClient.on('reconnect', () => { liveChatConnected = false; updateLiveChatStatus('connecting'); });
liveChatClient.on('close', () => { liveChatConnected = false; updateLiveChatStatus('offline'); });
liveChatClient.on('error', () => { liveChatConnected = false; updateLiveChatStatus('offline'); });
liveChatClient.on('message', (topic, payload) => {
try {
const data = JSON.parse(payload.toString());
if (topic === LIVE_CHAT_TOPIC) { receiveLiveChatMessage(data); }
else if (topic === LIVE_CALL_TOPIC) { receiveCallSignal(data); }
else if (topic.startsWith(LIVE_DM_TOPIC_PREFIX)) { receiveLiveDmMessage(topic, data); }
} catch(e) {}
});
} catch(e) { updateLiveChatStatus('unavailable'); }
}
function updateLiveChatStatus(state) {
const map = { connected: '🟢 Chat en vivo conectado', connecting: '🟡 Conectando…', offline: '🔴 Sin conexión', unavailable: '⚪ No disponible' };
const el = document.getElementById('liveChatStatus');
if (el) el.textContent = map[state] || map.connecting;
const statesMap = { connected: '🟢 Estados en vivo conectados', connecting: '🟡 Conectando estados en vivo…', offline: '🔴 Sin conexión', unavailable: '⚪ No disponible' };
const statesEl = document.getElementById('liveStatesStatus');
if (statesEl) statesEl.textContent = statesMap[state] || statesMap.connecting;
}
function receiveLiveChatMessage(msg) {
if (!msg || !currentUser) return;
if (msg.type === 'delete') {
if (!msg.id) return;
const db = getDB();
db.globalChat = (db.globalChat || []).filter(m => m.id !== msg.id);
localStorage.setItem('rutinasSvDB_v2', JSON.stringify(db));
if (document.getElementById('page-globalchat')?.classList.contains('active')) renderGlobalChat();
return;
}
if (!msg.id || !msg.userId || msg.userId === currentUser.id) return;
const db = getDB();
db.globalChat = db.globalChat || [];
if (db.globalChat.some(m => m.id === msg.id)) return;
db.globalChat.push(msg);
if (db.globalChat.length > 200) db.globalChat.splice(0, db.globalChat.length - 200);
localStorage.setItem('rutinasSvDB_v2', JSON.stringify(db));
if (document.getElementById('page-globalchat')?.classList.contains('active')) { renderGlobalChat(); }
else {
const badge = document.getElementById('chatBadge');
if (badge) { const n = (parseInt(badge.textContent) || 0) + 1; badge.textContent = n; badge.style.display = 'inline'; }
}
}
function publishLiveChatMessage(msg) { if (liveChatClient && liveChatConnected) { try { liveChatClient.publish(LIVE_CHAT_TOPIC, JSON.stringify(msg)); } catch(e) {} } }
function publishLiveChatDelete(msgId) { if (liveChatClient && liveChatConnected) { try { liveChatClient.publish(LIVE_CHAT_TOPIC, JSON.stringify({ type: 'delete', id: msgId })); } catch(e) {} } }

// ============================================================
// COMMUNITY TAB SWITCH
// ============================================================
function switchCommunityTab(tab) {
document.getElementById('communityTabBtnChat').classList.toggle('active', tab === 'chat');
document.getElementById('communityTabBtnStates').classList.toggle('active', tab === 'states');
document.getElementById('communityTabChat').style.display = tab === 'chat' ? 'block' : 'none';
document.getElementById('communityTabStates').style.display = tab === 'states' ? 'block' : 'none';
}

// ============================================================
// STATES
// ============================================================
function getStates() {
const db = getDB();
const states = db.states || [];
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const valid = states.filter(s => (now - s.timestamp) < DAY_MS);
if (valid.length !== states.length) { db.states = valid; saveDB(db); }
return valid.sort((a,b) => b.timestamp - a.timestamp);
}
function publishState() {
const text = document.getElementById('stateText').value.trim();
if (!text && !stateImageData) { showToast('Escribe algo o agrega una imagen', 'warning'); return; }
const db = getDB();
if (!db.states) db.states = [];
db.states.push({ id: 'state_' + Date.now(), userId: currentUser.id, username: currentUser.username, role: currentUser.role, text: text, image: stateImageData || null, timestamp: Date.now() });
saveDB(db);
document.getElementById('stateText').value = '';
clearStateImage();
closeStateCamera();
const habits = getHabits();
habits.statesPublished = (habits.statesPublished || 0) + 1;
saveHabits(habits);
checkAchievements();
renderStates();
addXP(5, '📸 Estado publicado');
showToast('📸 Estado publicado (durará 24h)', 'success');
}
function handleStateImage(event) {
const file = event.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = e => {
const img = new Image();
img.onload = () => {
const canvas = document.createElement('canvas');
const scale = Math.min(1, 800 / img.width);
canvas.width = img.width * scale;
canvas.height = img.height * scale;
canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
stateImageData = canvas.toDataURL('image/jpeg', 0.6);
document.getElementById('stateImagePreviewImg').src = stateImageData;
document.getElementById('stateImagePreview').style.display = 'block';
showToast('🖼️ Imagen lista', 'success');
};
img.src = e.target.result;
};
reader.readAsDataURL(file);
event.target.value = '';
}
function clearStateImage() {
stateImageData = null;
document.getElementById('stateImagePreview').style.display = 'none';
document.getElementById('stateImagePreviewImg').src = '';
}

// ====== CÁMARA DE ESTADOS ======
async function openStateCamera() {
const container = document.getElementById('stateCameraContainer');
if (!container) return;
if (stateCameraStream) { closeStateCamera(); return; }
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
showStateCamError('Tu navegador no soporta cámara. Usa "Subir Imagen".');
return;
}
try {
showToast('📷 Solicitando permiso...', 'success');
const constraints = { video: { facingMode: stateCameraFacing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
stateCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
const video = document.getElementById('stateCameraVideo');
if (!video) throw new Error('Video no encontrado');
video.srcObject = stateCameraStream;
await new Promise((resolve, reject) => {
video.onloadedmetadata = () => { video.play().then(resolve).catch(resolve); };
video.onerror = () => reject(new Error('Error al cargar video'));
setTimeout(() => reject(new Error('Timeout')), 8000);
});
stateCameraReady = true;
container.classList.add('active');
container.style.display = 'block';
video.style.transform = stateCameraFacing === 'user' ? 'scaleX(-1)' : 'none';
showToast('📷 Cámara lista — pulsa 📸', 'success');
} catch (err) {
stateCameraStream = null;
stateCameraReady = false;
let errorMsg = 'No se pudo acceder a la cámara.';
if (err.name === 'NotAllowedError') errorMsg = 'Permiso denegado. Activa la cámara en configuración.';
else if (err.name === 'NotFoundError') errorMsg = 'No se encontró cámara.';
else if (err.name === 'NotReadableError') errorMsg = 'Cámara en uso por otra app.';
showStateCamError(errorMsg);
}
}
function showStateCamError(message) {
const container = document.getElementById('stateCameraContainer');
if (!container) return;
container.classList.add('active');
container.style.display = 'block';
const oldErr = container.querySelector('.state-cam-error');
if (oldErr) oldErr.remove();
const errDiv = document.createElement('div');
errDiv.className = 'state-cam-error';
errDiv.innerHTML = `<div class="err-icon">📷</div><p>${message}</p><button class="btn btn-secondary btn-sm" onclick="closeStateCamera()" style="width:auto;margin-top:6px">Cerrar</button>`;
container.appendChild(errDiv);
}
function closeStateCamera() {
stateCameraReady = false;
stateCapturing = false;
if (stateCameraStream) { stateCameraStream.getTracks().forEach(track => track.stop()); stateCameraStream = null; }
const video = document.getElementById('stateCameraVideo');
if (video) { video.srcObject = null; video.style.transform = 'none'; }
const container = document.getElementById('stateCameraContainer');
if (container) {
container.classList.remove('active');
container.style.display = 'none';
const errEl = container.querySelector('.state-cam-error');
if (errEl) errEl.remove();
}
}
async function switchStateCamera() {
if (!stateCameraStream) return;
stateCameraFacing = stateCameraFacing === 'user' ? 'environment' : 'user';
stateCameraStream.getTracks().forEach(track => track.stop());
stateCameraStream = null;
stateCameraReady = false;
try {
const constraints = { video: { facingMode: stateCameraFacing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
stateCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
const video = document.getElementById('stateCameraVideo');
video.srcObject = stateCameraStream;
await new Promise((resolve) => {
video.onloadedmetadata = () => { video.play().then(resolve).catch(resolve); };
setTimeout(resolve, 3000);
});
stateCameraReady = true;
video.style.transform = stateCameraFacing === 'user' ? 'scaleX(-1)' : 'none';
showToast(stateCameraFacing === 'user' ? '📷 Cámara frontal' : '📷 Cámara trasera', 'success');
} catch (err) {
showToast('No se pudo cambiar la cámara', 'error');
}
}
function captureStatePhoto() {
if (!stateCameraStream || !stateCameraReady) { showToast('Espera a que la cámara esté lista', 'warning'); return; }
if (stateCapturing) return;
stateCapturing = true;
const video = document.getElementById('stateCameraVideo');
const canvas = document.getElementById('stateCameraCanvas');
const flash = document.getElementById('stateCamFlash');
if (!video || !canvas) { stateCapturing = false; showToast('Error interno', 'error'); return; }
const vw = video.videoWidth;
const vh = video.videoHeight;
if (!vw || !vh) { stateCapturing = false; showToast('Cámara no lista', 'warning'); return; }
try {
if (flash) { flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash'); }
canvas.width = vw;
canvas.height = vh;
const ctx = canvas.getContext('2d');
if (!ctx) { stateCapturing = false; showToast('Error de contexto', 'error'); return; }
ctx.save();
if (stateCameraFacing === 'user') { ctx.translate(vw, 0); ctx.scale(-1, 1); }
ctx.drawImage(video, 0, 0, vw, vh);
ctx.restore();
const maxW = 900;
const scale = Math.min(1, maxW / vw);
const finalW = Math.round(vw * scale);
const finalH = Math.round(vh * scale);
const finalCanvas = document.createElement('canvas');
finalCanvas.width = finalW;
finalCanvas.height = finalH;
finalCanvas.getContext('2d').drawImage(canvas, 0, 0, finalW, finalH);
stateImageData = finalCanvas.toDataURL('image/jpeg', 0.7);
if (!stateImageData || stateImageData.length < 100) { stateCapturing = false; showToast('Error al procesar', 'error'); return; }
const previewImg = document.getElementById('stateImagePreviewImg');
const previewDiv = document.getElementById('stateImagePreview');
if (previewImg && previewDiv) { previewImg.src = stateImageData; previewDiv.style.display = 'block'; }
closeStateCamera();
showToast('📸 ¡Foto capturada!', 'success');
} catch (err) {
showToast('Error al capturar: ' + (err.message || 'inténtalo de nuevo'), 'error');
} finally {
stateCapturing = false;
}
}
function stopStateCamera() { closeStateCamera(); }

function renderStates() {
const container = document.getElementById('statesFeed');
if (!container) return;
const states = getStates();
if (states.length === 0) {
container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📸</div><h3>Sin estados aún</h3></div>';
return;
}
const db = getDB();
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
container.innerHTML = states.map(state => {
const user = db.users.find(u => u.id === state.userId) || { username: state.username, role: 'user' };
const timeAgo = getTimeAgo(state.timestamp);
const expiresAt = state.timestamp + DAY_MS;
const remaining = Math.max(0, expiresAt - now);
const hoursLeft = Math.floor(remaining / (60 * 60 * 1000));
const isExpired = remaining <= 0;
const isOwn = state.userId === currentUser.id;
const showcase = getUserShowcase(state.userId);
const showcaseIcons = showcase.slice(0,3).map(id => { const ach = ACHIEVEMENTS.find(a => a.id === id); return ach ? ach.icon : ''; }).join('');
const roleLabels = { boss: '👑', admin: '🛡️', user: '' };
return `<div class="state-card ${isExpired?'state-expired':''}">
<div class="state-card-header">
<div class="state-avatar">${user.username.charAt(0).toUpperCase()}</div>
<div class="state-user-info">
<div class="state-user-name">${user.username} ${roleLabels[user.role]||''} ${showcaseIcons}</div>
<div class="state-user-time">${timeAgo} • ⏰ ${hoursLeft}h restantes</div>
</div>
</div>
${state.image ? `<div class="state-card-body has-image"><img src="${state.image}" alt="Estado"></div>` : `<div class="state-card-body">${escapeHtml(state.text)}</div>`}
<div class="state-card-footer">
<span>📅 ${new Date(state.timestamp).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
${isOwn ? `<button class="state-delete-btn" onclick="deleteState('${state.id}')">🗑️ Eliminar</button>` : ''}
</div>
</div>`;
}).join('');
}
function getTimeAgo(timestamp) {
const diff = Date.now() - timestamp;
const mins = Math.floor(diff / 60000);
if (mins < 1) return 'Ahora';
if (mins < 60) return mins + 'min';
const hours = Math.floor(mins / 60);
if (hours < 24) return hours + 'h';
const days = Math.floor(hours / 24);
return days + 'd';
}
function deleteState(id) { if (!confirm('¿Eliminar este estado?')) return; const db = getDB(); db.states = (db.states || []).filter(s => s.id !== id); saveDB(db); renderStates(); showToast('🗑️ Estado eliminado', 'warning'); }
function refreshStates() { renderStates(); showToast('🔄 Actualizado', 'success'); }

// ============================================================
// DM (CHATS PRIVADOS)
// ============================================================
// ============================================================
// RUTINAS EN ÓRBITA — chat anclado a tareas/rutinas compartidas
// ============================================================
const ENERGY_META = {
alta:  { icon:'⚡', label:'Energía alta',  color:'#2a9d8f' },
media: { icon:'🌤️', label:'Energía media', color:'#e9c46a' },
baja:  { icon:'🌙', label:'Energía baja',  color:'#6c757d' }
};
const PULSE_PRESETS = [
{ key:'done', icon:'✅', text:'¿Ya lo hiciste?' },
{ key:'progress', icon:'🌱', text:'¿Cómo vas?' },
{ key:'boost', icon:'🔥', text:'¡Vamos, tú puedes!' },
{ key:'sync', icon:'🔄', text:'¿Coordinamos horario?' }
];
const ENERGY_REACTIONS = [
{ key:'fire', icon:'🔥', label:'Motivado' },
{ key:'tired', icon:'😴', label:'Cansado' },
{ key:'sprout', icon:'🌱', label:'Progresando' },
{ key:'strong', icon:'💪', label:'Con fuerza' },
{ key:'calm', icon:'🌊', label:'En calma' }
];
let activeCapsule = null; // { convId, taskId, peerId, taskTitle, taskIcon }
let capsuleTypingTimeout = null;
let rcSelectedTaskId = null, rcSelectedPeerId = null;

function computeEnergyLevel(userId) {
const db = getDB();
const tasks = (db.tasks || []).filter(t => t.userId === userId);
const today = new Date().toISOString().split('T')[0];
const todays = tasks.filter(t => t.date === today);
if (!todays.length) return 'media';
const ratio = todays.filter(t => t.completed).length / todays.length;
if (ratio >= 0.66) return 'alta';
if (ratio >= 0.33) return 'media';
return 'baja';
}
function energyPillHtml(level) {
const m = ENERGY_META[level] || ENERGY_META.media;
return `<span class="energy-pill ${level}">${m.icon} ${m.label}</span>`;
}
function getRoutineConvId(taskId, a, b) { return 'rconv_' + taskId + '__' + [a, b].sort().join('_'); }
function getRoutineTopic(convId) { return LIVE_DM_TOPIC_PREFIX + convId; }
function getRoutineConversations() { const db = getDB(); return (db.dmConversations || {})[currentUser?.id] || []; }
function getActiveRoutineConversations() { return getRoutineConversations().filter(c => c.status !== 'harvested'); }
function getArchivedRoutineConversations() { return getRoutineConversations().filter(c => c.status === 'harvested'); }
function getRoutineMessages(convId) { const db = getDB(); return (db.dmMessages || {})[convId] || []; }
function saveRoutineMessages(convId, messages) { const db = getDB(); if (!db.dmMessages) db.dmMessages = {}; db.dmMessages[convId] = messages; saveDB(db); }
function taskHasRoutineChat(taskId) { return getRoutineConversations().some(c => c.taskId === taskId && c.status !== 'harvested'); }
function taskHasRoutineChatUnread(taskId) { const c = getRoutineConversations().find(x => x.taskId === taskId); return !!(c && c.unread > 0); }

function subscribeRoutineTopic(convId) {
if (!liveChatClient || !liveChatConnected) return;
const topic = getRoutineTopic(convId);
if (dmSubscribedTopics.has(topic)) return;
try { liveChatClient.subscribe(topic); dmSubscribedTopics.add(topic); } catch(e) {}
}

function ensureRoutineConversation(taskId, peerId, taskTitle, taskIcon) {
const convId = getRoutineConvId(taskId, currentUser.id, peerId);
const db = getDB();
if (!db.dmConversations) db.dmConversations = {};
[currentUser.id, peerId].forEach(uid => { if (!db.dmConversations[uid]) db.dmConversations[uid] = []; });
let mine = db.dmConversations[currentUser.id].find(c => c.convId === convId);
if (!mine) { mine = { convId, taskId, taskTitle, taskIcon: taskIcon || '📌', peerId, ownerId: currentUser.id, createdAt: Date.now(), lastMessageAt: Date.now(), unread: 0, status: 'active' }; db.dmConversations[currentUser.id].unshift(mine); }
let theirs = db.dmConversations[peerId].find(c => c.convId === convId);
if (!theirs) { theirs = { convId, taskId, taskTitle, taskIcon: taskIcon || '📌', peerId: currentUser.id, ownerId: currentUser.id, createdAt: Date.now(), lastMessageAt: Date.now(), unread: 0, status: 'active' }; db.dmConversations[peerId].unshift(theirs); }
saveDB(db);
subscribeRoutineTopic(convId);
return convId;
}

// ---- vista de listado / orbital ----
function switchRoutineChatTab(tab) {
document.getElementById('rcTabActive').classList.toggle('active', tab === 'active');
document.getElementById('rcTabArchive').classList.toggle('active', tab === 'archive');
document.getElementById('rcActiveView').style.display = tab === 'active' ? 'block' : 'none';
document.getElementById('rcArchiveView').style.display = tab === 'archive' ? 'block' : 'none';
if (tab === 'archive') renderArchivedRoutineChats(); else RoutineChatOrbital.refresh();
}
function renderArchivedRoutineChats() {
const list = getArchivedRoutineConversations();
const container = document.getElementById('rcArchiveList');
if (!container) return;
if (list.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:30px 10px"><div class="empty-icon" style="font-size:2em">🌾</div><h3 style="font-size:1em">Nada cosechado todavía</h3><p style="font-size:0.85em">Cuando completes una rutina compartida, su hilo se archiva aquí</p></div>'; return; }
const db = getDB();
container.innerHTML = list.map(c => {
const peer = db.users.find(u => u.id === c.peerId);
return `<div class="rc-archive-item">
<div class="rc-archive-icon">${c.taskIcon || '🌾'}</div>
<div class="rc-archive-info">
<div class="rc-archive-title">${escapeHtml(c.taskTitle || 'Rutina')}</div>
<div class="rc-archive-sub">con ${peer ? peer.username : 'Usuario'} · cosechado ${getTimeAgo(c.harvestedAt || c.lastMessageAt)}</div>
</div>
</div>`;
}).join('');
}
function handleRoutineOrbitalBgClick(e) { if (e.target.closest && (e.target.closest('.orbital-card') || e.target.closest('.orbital-node-btn'))) return; RoutineChatOrbital.reset(); }

// ---- modal: vincular chat a rutina ----
function openNewRoutineChatModal() {
rcSelectedTaskId = null; rcSelectedPeerId = null;
const tasks = getTasks().filter(t => !t.completed);
const taskList = document.getElementById('rcTaskPickList');
if (tasks.length === 0) { taskList.innerHTML = '<p style="color:var(--text-light);font-size:0.85em;padding:8px">No tienes tareas pendientes. Crea una en "Mis Tareas".</p>'; }
else {
const catIcons = { trabajo:'💼', salud:'❤️', personal:'💜', estudio:'📚', hogar:'🏡', otro:'📌' };
taskList.innerHTML = tasks.map(t => `<div class="rc-task-pick" data-task="${t.id}" onclick="pickRoutineTask('${t.id}',this)"><span>${catIcons[t.category]||'📌'}</span><span style="flex:1;font-size:0.88em">${escapeHtml(t.title)}</span></div>`).join('');
}
const db = getDB();
const users = (db.users || []).filter(u => u.id !== currentUser.id);
const userList = document.getElementById('rcUserPickList');
if (users.length === 0) { userList.innerHTML = '<p style="color:var(--text-light);font-size:0.85em;padding:8px">No hay otros usuarios.</p>'; }
else {
const avatarColors = ['#4361ee','#2a9d8f','#e76f51','#7209b7','#e9c46a','#f4a261'];
userList.innerHTML = users.map(u => {
const colorIdx = u.id.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % avatarColors.length;
const lvl = computeEnergyLevel(u.id);
return `<div class="rc-user-pick" data-peer="${u.id}" onclick="pickRoutinePeer('${u.id}',this)">
<div style="width:34px;height:34px;border-radius:50%;background:${avatarColors[colorIdx]};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.85em">${u.username.charAt(0).toUpperCase()}</div>
<div style="flex:1"><div style="font-weight:600;font-size:0.88em">${u.username}</div></div>
${energyPillHtml(lvl)}
</div>`;
}).join('');
}
document.getElementById('newDmModal').classList.add('show');
}
function pickRoutineTask(taskId, el) { rcSelectedTaskId = taskId; document.querySelectorAll('.rc-task-pick').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); }
function pickRoutinePeer(peerId, el) { rcSelectedPeerId = peerId; document.querySelectorAll('.rc-user-pick').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); }
function confirmNewRoutineChat() {
if (!rcSelectedTaskId) { showToast('Elige una rutina o tarea', 'warning'); return; }
if (!rcSelectedPeerId) { showToast('Elige con quién compartirla', 'warning'); return; }
const task = getTasks().find(t => t.id === rcSelectedTaskId);
if (!task) return;
const catIcons = { trabajo:'💼', salud:'❤️', personal:'💜', estudio:'📚', hogar:'🏡', otro:'📌' };
const convId = ensureRoutineConversation(rcSelectedTaskId, rcSelectedPeerId, task.title, catIcons[task.category]);
closeModal('newDmModal');
navigateTo('privatechats');
setTimeout(() => openRoutineCapsule(convId), 150);
}

// ---- cápsula flotante ----
function openOrLinkTaskCapsule(taskId) {
const conv = getRoutineConversations().find(c => c.taskId === taskId && c.status !== 'harvested');
if (conv) { openRoutineCapsule(conv.convId); return; }
rcSelectedTaskId = taskId;
openNewRoutineChatModal();
setTimeout(() => { const el = document.querySelector('.rc-task-pick[data-task="' + taskId + '"]'); if (el) pickRoutineTask(taskId, el); }, 50);
}
function openRoutineCapsule(convId) {
const db = getDB();
const conv = getRoutineConversations().find(c => c.convId === convId);
if (!conv) { showToast('Chat no encontrado', 'error'); return; }
const peer = db.users.find(u => u.id === conv.peerId);
if (!peer) { showToast('Usuario no encontrado', 'error'); return; }
activeCapsule = { convId, taskId: conv.taskId, peerId: conv.peerId, taskTitle: conv.taskTitle, taskIcon: conv.taskIcon };
document.getElementById('capsuleTaskLabel').textContent = 'Rutina · ' + (conv.taskIcon || '📌');
document.getElementById('capsuleTaskTitle').textContent = conv.taskTitle || 'Rutina compartida';
document.getElementById('capsulePeerName').textContent = peer.username;
const lvl = computeEnergyLevel(peer.id);
const m = ENERGY_META[lvl];
const pill = document.getElementById('capsulePeerEnergy');
pill.className = 'energy-pill ' + lvl;
pill.textContent = m.icon + ' ' + m.label;
document.getElementById('capsuleReactions').innerHTML = ENERGY_REACTIONS.map(r => `<div class="reaction-chip" onclick="sendReaction('${r.key}')">${r.icon} ${r.label}</div>`).join('');
document.getElementById('chatCapsule').classList.add('open');
conv.unread = 0; saveDB(db);
renderCapsuleMessages();
renderTasks();
updateDmBadge();
}
function closeRoutineCapsule() { document.getElementById('chatCapsule').classList.remove('open'); activeCapsule = null; }

function messageStage(msg, allMessages) {
if (msg.actionConfirmed) return 'bloom';
const laterExists = allMessages.some(m => m.timestamp > msg.timestamp);
if (msg.reaction || laterExists) return 'sprout';
return 'seed';
}
const STAGE_ICON = { seed:'🌰', sprout:'🌿', bloom:'🌸' };
const STAGE_LABEL = { seed:'semilla', sprout:'brotando', bloom:'floreció' };

function renderCapsuleMessages() {
if (!activeCapsule) return;
const container = document.getElementById('capsuleBody');
const db = getDB();
const peer = db.users.find(u => u.id === activeCapsule.peerId);
const messages = getRoutineMessages(activeCapsule.convId);
const harvestToast = document.getElementById('capsuleHarvestToast');
if (messages.length === 0) {
container.innerHTML = `<div style="text-align:center;padding:30px 10px;color:var(--text-light)"><div style="font-size:2.2em">🌱</div><h3 style="font-size:0.95em;margin-top:6px">Siembra el primer mensaje de esta rutina con ${peer ? peer.username : ''}</h3></div>`;
container.appendChild(harvestToast);
return;
}
container.innerHTML = messages.map(msg => {
const isOwn = msg.fromId === currentUser.id;
const stage = messageStage(msg, messages);
const time = new Date(msg.timestamp).toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
const reactionHtml = msg.reaction ? `<span class="seed-msg-reaction">${(ENERGY_REACTIONS.find(r=>r.key===msg.reaction)||{}).icon||''}</span>` : '';
const actionTag = msg.actionConfirmed ? `<div class="seed-msg-action-tag">✅ ${escapeHtml(msg.actionLabel || 'Acción confirmada')}</div>` : '';
if (msg.type === 'pulse') {
return `<div class="seed-msg ${isOwn?'own':''}" data-stage="${stage}">
<div class="seed-msg-plant">${STAGE_ICON[stage]}</div>
<div class="seed-msg-wrap">
<div class="seed-msg-pulse-bubble">💓 ${escapeHtml(msg.text)}</div>
${actionTag}
<div class="seed-msg-meta"><span class="seed-msg-stage-label ${stage}">${STAGE_ICON[stage]} ${STAGE_LABEL[stage]}</span><span>${time}</span>${reactionHtml}</div>
</div>
</div>`;
}
return `<div class="seed-msg ${isOwn?'own':''}" data-stage="${stage}">
<div class="seed-msg-plant">${STAGE_ICON[stage]}</div>
<div class="seed-msg-wrap">
<div class="seed-msg-bubble">${escapeHtml(msg.text)}</div>
${actionTag}
<div class="seed-msg-meta"><span class="seed-msg-stage-label ${stage}">${STAGE_ICON[stage]} ${STAGE_LABEL[stage]}</span><span>${time}</span>${reactionHtml}</div>
</div>
</div>`;
}).join('');
container.appendChild(harvestToast);
container.scrollTop = container.scrollHeight;
}

function sendRoutineMessage() {
if (!activeCapsule) return;
const input = document.getElementById('capsuleInput');
const text = input.value.trim();
if (!text) return;
pushRoutineMessage({ type: 'text', text });
input.value = '';
}
function sendPulse(key) {
const preset = PULSE_PRESETS.find(p => p.key === key);
if (!preset || !activeCapsule) return;
pushRoutineMessage({ type: 'pulse', text: preset.text, pulseKey: key });
togglePulsePopover(true);
}
function pushRoutineMessage(partial) {
if (!activeCapsule) return;
const msg = Object.assign({ id: 'rm_' + Date.now() + '_' + Math.random().toString(16).slice(2,8), fromId: currentUser.id, fromName: currentUser.username, toId: activeCapsule.peerId, timestamp: Date.now(), actionConfirmed: false, reaction: null }, partial);
const messages = getRoutineMessages(activeCapsule.convId);
messages.push(msg);
saveRoutineMessages(activeCapsule.convId, messages);
updateRoutineConversationMeta(activeCapsule.convId, msg);
publishRoutineMessage(activeCapsule.convId, msg);
renderCapsuleMessages();
const habits = getHabits();
habits.dmMessages = (habits.dmMessages || 0) + 1;
saveHabits(habits);
checkAchievements();
addXP(2, '🌱 Mensaje de rutina compartida');
}
function sendReaction(key) {
if (!activeCapsule) return;
const messages = getRoutineMessages(activeCapsule.convId);
const lastFromPeer = [...messages].reverse().find(m => m.fromId !== currentUser.id);
const target = lastFromPeer || messages[messages.length - 1];
if (!target) { showToast('Aún no hay mensajes para reaccionar', 'warning'); return; }
target.reaction = key;
saveRoutineMessages(activeCapsule.convId, messages);
publishRoutineMessage(activeCapsule.convId, { id: 'reaction_' + Date.now(), type: 'reaction-sync', targetId: target.id, reaction: key, fromId: currentUser.id, toId: activeCapsule.peerId, timestamp: Date.now() });
plantSharedGardenFlower('reaccion');
renderCapsuleMessages();
}
function confirmRoutineAction(label) {
if (!activeCapsule) return;
confirmRoutineActionForConv(activeCapsule.convId, label);
plantSharedGardenFlower('coordinacion');
renderCapsuleMessages();
}
function confirmRoutineActionForTask(taskId, label) {
const conv = getRoutineConversations().find(c => c.taskId === taskId && c.status !== 'harvested');
if (!conv) return;
confirmRoutineActionForConv(conv.convId, label);
}
function confirmRoutineActionForConv(convId, label) {
const messages = getRoutineMessages(convId);
const last = messages[messages.length - 1];
if (last) { last.actionConfirmed = true; last.actionLabel = label; saveRoutineMessages(convId, messages); }
if (liveChatClient && liveChatConnected) { try { liveChatClient.publish(getRoutineTopic(convId), JSON.stringify({ type: 'action-sync', targetId: last ? last.id : null, actionLabel: label, fromId: currentUser.id, timestamp: Date.now() })); } catch(e) {} }
}
function togglePulsePopover(forceClose) {
const pop = document.getElementById('pulsePopover');
if (forceClose) { pop.classList.remove('show'); return; }
if (pop.classList.contains('show')) { pop.classList.remove('show'); return; }
pop.innerHTML = PULSE_PRESETS.map(p => `<button class="pulse-option" onclick="sendPulse('${p.key}')">${p.icon} ${p.text}</button>`).join('');
pop.classList.add('show');
}
function handleCapsuleTyping() {
if (!activeCapsule || !liveChatClient || !liveChatConnected) return;
try { liveChatClient.publish(getRoutineTopic(activeCapsule.convId), JSON.stringify({ type: 'typing', fromId: currentUser.id, toId: activeCapsule.peerId, convId: activeCapsule.convId, timestamp: Date.now() })); } catch(e) {}
}
function showGrowingIndicator(show) {
const el = document.getElementById('capsuleGrowingIndicator');
if (!el) return;
el.style.display = show ? 'flex' : 'none';
}

function updateRoutineConversationMeta(convId, msg) {
const db = getDB();
if (!db.dmConversations) db.dmConversations = {};
[msg.fromId, msg.toId].forEach(uid => {
if (!db.dmConversations[uid]) db.dmConversations[uid] = [];
const conv = db.dmConversations[uid].find(c => c.convId === convId);
if (conv) { conv.lastMessageAt = msg.timestamp; if (uid === msg.toId && (!activeCapsule || activeCapsule.convId !== convId)) conv.unread = (conv.unread || 0) + 1; }
});
saveDB(db);
}
function publishRoutineMessage(convId, msg) { if (liveChatClient && liveChatConnected) { try { liveChatClient.publish(getRoutineTopic(convId), JSON.stringify(msg)); } catch(e) {} } }

function receiveLiveDmMessage(topic, data) {
if (!data || !currentUser) return;
const convId = topic.slice(LIVE_DM_TOPIC_PREFIX.length);
if (data.type === 'typing') {
if (data.fromId === currentUser.id) return;
if (activeCapsule && activeCapsule.convId === convId) {
showGrowingIndicator(true);
clearTimeout(capsuleTypingTimeout);
capsuleTypingTimeout = setTimeout(() => showGrowingIndicator(false), 2500);
}
return;
}
if (data.type === 'reaction-sync') {
if (data.fromId === currentUser.id) return;
const messages = getRoutineMessages(convId);
const target = messages.find(m => m.id === data.targetId);
if (target) { target.reaction = data.reaction; saveRoutineMessages(convId, messages); if (activeCapsule && activeCapsule.convId === convId) renderCapsuleMessages(); }
return;
}
if (data.type === 'action-sync') {
if (data.fromId === currentUser.id) return;
const messages = getRoutineMessages(convId);
const target = data.targetId ? messages.find(m => m.id === data.targetId) : messages[messages.length - 1];
if (target) { target.actionConfirmed = true; target.actionLabel = data.actionLabel; saveRoutineMessages(convId, messages); if (activeCapsule && activeCapsule.convId === convId) renderCapsuleMessages(); }
return;
}
if (!data.id || !data.fromId) return;
if (data.fromId === currentUser.id) return;
if (data.toId !== currentUser.id) return;
const messages = getRoutineMessages(convId);
if (messages.some(m => m.id === data.id)) return;
messages.push(data);
saveRoutineMessages(convId, messages);
updateRoutineConversationMeta(convId, data);
if (activeCapsule && activeCapsule.convId === convId) {
renderCapsuleMessages();
showGrowingIndicator(false);
} else {
const db = getDB();
const fromUser = db.users.find(u => u.id === data.fromId);
const name = fromUser?.username || 'Usuario';
showToast(`🌱 ${name}: ${data.text ? data.text.slice(0,40) : 'nuevo mensaje'}`, 'success');
playThemeEcho();
}
if (document.getElementById('page-privatechats')?.classList.contains('active')) RoutineChatOrbital.refresh();
updateDmBadge();
}
function updateDmBadge() {
const total = getActiveRoutineConversations().reduce((s, c) => s + (c.unread || 0), 0);
const badge = document.getElementById('dmBadge');
if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'inline' : 'none'; }
}

// ---- hilos que se cierran por logro (cosecha) ----
function harvestRoutineThread(taskId) {
const db = getDB();
const conv = ((db.dmConversations || {})[currentUser.id] || []).find(c => c.taskId === taskId && c.status !== 'harvested');
if (!conv) return;
[conv.peerId, currentUser.id].forEach(uid => {
const list = (db.dmConversations[uid] || []);
const c = list.find(x => x.convId === conv.convId);
if (c) { c.status = 'harvested'; c.harvestedAt = Date.now(); }
});
saveDB(db);
plantSharedGardenFlower('cosecha');
if (activeCapsule && activeCapsule.convId === conv.convId) {
const toast = document.getElementById('capsuleHarvestToast');
document.getElementById('capsuleBody').classList.add('harvesting');
toast.style.display = 'flex';
setTimeout(() => { closeRoutineCapsule(); document.getElementById('capsuleBody').classList.remove('harvesting'); toast.style.display = 'none'; }, 1400);
}
if (document.getElementById('page-privatechats')?.classList.contains('active')) RoutineChatOrbital.refresh();
showToast('🌾 Rutina completada — el chat se cosechó', 'success');
}

// ---- rastro visual en el jardín ----
function plantSharedGardenFlower(reason) {
const db = getDB();
if (!db.gardenTrail) db.gardenTrail = [];
db.gardenTrail.push({ id: 'trail_' + Date.now(), userId: currentUser.id, reason, ts: Date.now() });
saveDB(db);
if (document.getElementById('page-garden')?.classList.contains('active')) renderGarden();
}
function getGardenTrail() { const db = getDB(); return (db.gardenTrail || []).filter(t => t.userId === currentUser?.id); }

// ---- eco sonoro temático (Web Audio API) ----
function playThemeEcho() {
const db = getDB();
if (db.settings && db.settings.soundNotif === false) return;
const theme = document.documentElement.getAttribute('data-theme') || 'bosque';
try {
const ctx = new (window.AudioContext || window.webkitAudioContext)();
if (theme === 'oceano' || theme === 'tropical') {
const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
const d = buf.getChannelData(0); let last = 0;
for (let i = 0; i < d.length; i++) { const w = Math.random()*2-1; d[i] = (last = last*0.98 + w*0.02) * 12; }
const src = ctx.createBufferSource(); src.buffer = buf;
const g = ctx.createGain(); g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.25, ctx.currentTime+0.1); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.6);
src.connect(g); g.connect(ctx.destination); src.start(); src.stop(ctx.currentTime+0.6);
} else if (theme === 'volcan' || theme === 'desierto') {
for (let i=0;i<3;i++) {
const o = ctx.createOscillator(), g = ctx.createGain();
o.type = 'square'; o.frequency.value = 90 + Math.random()*60;
g.gain.setValueAtTime(0.15, ctx.currentTime + i*0.09); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i*0.09 + 0.08);
o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + i*0.09); o.stop(ctx.currentTime + i*0.09 + 0.08);
}
} else if (theme === 'aurora' || theme === 'galaxia' || theme === 'lavanda') {
const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = 660; o2.frequency.value = 990;
g.gain.setValueAtTime(0.001, ctx.currentTime); g.gain.linearRampToValueAtTime(0.18, ctx.currentTime+0.05); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+1.1);
o1.connect(g); o2.connect(g); g.connect(ctx.destination); o1.start(); o2.start(); o1.stop(ctx.currentTime+1.1); o2.stop(ctx.currentTime+1.1);
} else {
const o = ctx.createOscillator(), g = ctx.createGain();
o.type = 'triangle'; o.frequency.setValueAtTime(1400, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime+0.25);
g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.3);
o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.3);
}
} catch(e) {}
}

// ---- encuentros junto a la fogata (llamadas) ----
function startRoutineCall(type) {
if (!activeCapsule) { showToast('Abre un chat de rutina primero', 'warning'); return; }
initiateCall(activeCapsule.peerId, type);
}

// ============================================================
// VIDEOLLAMADA
// ============================================================
async function initiateCall(peerId, type) {
const db = getDB();
const peer = db.users.find(u => u.id === peerId);
if (!peer) return;
let localStream = null;
try { localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true }); }
catch(e) { showToast('No se pudo acceder a ' + (type === 'video' ? 'la cámara' : 'el micrófono'), 'error'); return; }
activeCall = { peerId, peerName: peer.username, peerAvatar: peer.username.charAt(0).toUpperCase(), type, startedAt: null, timerInterval: null, localStream, mutedMic: false, mutedCam: false, callId: 'call_' + Date.now() + '_' + Math.random().toString(16).slice(2,6) };
const localVideo = document.getElementById('callLocalVideo');
localVideo.srcObject = localStream;
const avatarColors = ['#4361ee','#2a9d8f','#e76f51','#7209b7','#e9c46a','#f4a261'];
const colorIdx = peer.id.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % avatarColors.length;
document.getElementById('callPeerAvatar').textContent = peer.username.charAt(0).toUpperCase();
document.getElementById('callPeerAvatar').style.background = avatarColors[colorIdx];
document.getElementById('callPeerName').textContent = peer.username;
document.getElementById('callStatusAvatar').textContent = peer.username.charAt(0).toUpperCase();
document.getElementById('callStatusAvatar').style.background = avatarColors[colorIdx];
document.getElementById('callStatusName').textContent = peer.username;
document.getElementById('callStatusTextBig').textContent = type === 'video' ? '🔥 Encendiendo fogata con video...' : '🔥 Encendiendo fogata...';
document.getElementById('callStatusOverlay').classList.remove('hidden');
document.getElementById('callOverlay').classList.add('active');
startCampfireAmbiance();
publishCallSignal({ type: 'incoming', callId: activeCall.callId, fromId: currentUser.id, fromName: currentUser.username, fromAvatar: currentUser.username.charAt(0).toUpperCase(), toId: peerId, callType: type, timestamp: Date.now() });
activeCall.noAnswerTimeout = setTimeout(() => {
if (activeCall && !activeCall.startedAt) { showToast('⏰ ' + peer.username + ' no respondió', 'warning'); hangupCall(); }
}, 30000);
}
function publishCallSignal(data) { if (liveChatClient && liveChatConnected) { try { liveChatClient.publish(LIVE_CALL_TOPIC, JSON.stringify(data)); } catch(e) {} } }
function receiveCallSignal(data) {
if (!data || !currentUser) return;
if (data.type === 'incoming' && data.toId === currentUser.id) {
if (activeCall || incomingCallData) return;
incomingCallData = data;
showIncomingCall(data);
} else if (data.type === 'accepted' && data.toId === currentUser.id && activeCall && activeCall.callId === data.callId) {
acceptCallConfirmed();
} else if (data.type === 'rejected' && data.toId === currentUser.id && activeCall && activeCall.callId === data.callId) {
showToast('📵 ' + activeCall.peerName + ' rechazó', 'warning');
hangupCall();
} else if (data.type === 'hangup' && data.toId === currentUser.id && activeCall && activeCall.callId === data.callId) {
showToast('🧯 ' + activeCall.peerName + ' apagó la fogata', 'success');
hangupCall();
}
}
function showIncomingCall(data) {
document.getElementById('callIncomingAvatar').textContent = data.fromAvatar;
document.getElementById('callIncomingName').textContent = data.fromName;
document.getElementById('callIncoming').classList.add('active');
playRingtone();
}
function acceptCall() {
if (!incomingCallData) return;
stopRingtone();
document.getElementById('callIncoming').classList.remove('active');
publishCallSignal({ type: 'accepted', callId: incomingCallData.callId, fromId: currentUser.id, toId: incomingCallData.fromId, timestamp: Date.now() });
initiateCallAsReceiver(incomingCallData);
incomingCallData = null;
}
function rejectCall() {
if (!incomingCallData) return;
stopRingtone();
publishCallSignal({ type: 'rejected', callId: incomingCallData.callId, fromId: currentUser.id, toId: incomingCallData.fromId, timestamp: Date.now() });
document.getElementById('callIncoming').classList.remove('active');
incomingCallData = null;
showToast('📵 Llamada rechazada', 'warning');
}
async function initiateCallAsReceiver(data) {
let localStream = null;
try { localStream = await navigator.mediaDevices.getUserMedia({ video: data.callType === 'video', audio: true }); }
catch(e) { showToast('No se pudo acceder a los dispositivos', 'error'); return; }
const db = getDB();
const peer = db.users.find(u => u.id === data.fromId);
const avatarColors = ['#4361ee','#2a9d8f','#e76f51','#7209b7','#e9c46a','#f4a261'];
const colorIdx = data.fromId.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % avatarColors.length;
activeCall = { peerId: data.fromId, peerName: data.fromName, peerAvatar: data.fromAvatar, type: data.callType, startedAt: Date.now(), timerInterval: null, localStream, mutedMic: false, mutedCam: false, callId: data.callId };
const localVideo = document.getElementById('callLocalVideo');
localVideo.srcObject = localStream;
document.getElementById('callPeerAvatar').textContent = data.fromAvatar;
document.getElementById('callPeerAvatar').style.background = avatarColors[colorIdx];
document.getElementById('callPeerName').textContent = data.fromName;
document.getElementById('callStatusOverlay').classList.add('hidden');
document.getElementById('callOverlay').classList.add('active');
startCampfireAmbiance();
startCallTimer();
const habits = getHabits();
habits.videoCalls = (habits.videoCalls || 0) + 1;
saveHabits(habits);
checkAchievements();
}
function acceptCallConfirmed() {
if (!activeCall) return;
if (activeCall.noAnswerTimeout) { clearTimeout(activeCall.noAnswerTimeout); activeCall.noAnswerTimeout = null; }
activeCall.startedAt = Date.now();
document.getElementById('callStatusOverlay').classList.add('hidden');
startCallTimer();
const habits = getHabits();
habits.videoCalls = (habits.videoCalls || 0) + 1;
saveHabits(habits);
checkAchievements();
}
function startCallTimer() {
if (activeCall.timerInterval) clearInterval(activeCall.timerInterval);
activeCall.timerInterval = setInterval(() => {
if (!activeCall || !activeCall.startedAt) return;
const elapsed = Math.floor((Date.now() - activeCall.startedAt) / 1000);
const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
const s = (elapsed % 60).toString().padStart(2, '0');
document.getElementById('callTimer').textContent = `${m}:${s}`;
}, 1000);
}
function hangupCall() {
if (!activeCall) return;
publishCallSignal({ type: 'hangup', callId: activeCall.callId, fromId: currentUser.id, toId: activeCall.peerId, timestamp: Date.now() });
if (activeCall.noAnswerTimeout) { clearTimeout(activeCall.noAnswerTimeout); }
if (activeCall.timerInterval) { clearInterval(activeCall.timerInterval); }
if (activeCall.localStream) { activeCall.localStream.getTracks().forEach(t => t.stop()); }
activeCall = null;
stopCampfireAmbiance();
document.getElementById('callOverlay').classList.remove('active');
document.getElementById('callLocalVideo').srcObject = null;
document.getElementById('callTimer').textContent = '00:00';
}
function cancelCall() { hangupCall(); }
let campfireEmberInterval = null, campfireAudioCtx = null, campfireCrackleNode = null;
function startCampfireAmbiance() {
const embers = document.getElementById('campfireEmbers');
if (embers && !campfireEmberInterval) {
campfireEmberInterval = setInterval(() => {
if (!document.getElementById('callOverlay').classList.contains('active')) return;
const e = document.createElement('div');
e.className = 'campfire-ember';
e.style.left = (46 + Math.random()*8) + '%';
e.style.animationDuration = (2.4 + Math.random()*1.6) + 's';
e.style.opacity = (0.6 + Math.random()*0.4);
embers.appendChild(e);
setTimeout(() => e.remove(), 4000);
}, 260);
}
try {
const db = getDB();
if (db.settings && db.settings.soundNotif === false) return;
if (campfireAudioCtx) return;
campfireAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
const master = campfireAudioCtx.createGain(); master.gain.value = 0.12; master.connect(campfireAudioCtx.destination);
function crackle() {
if (!campfireAudioCtx) return;
const buf = campfireAudioCtx.createBuffer(1, campfireAudioCtx.sampleRate*0.05, campfireAudioCtx.sampleRate);
const d = buf.getChannelData(0); for (let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 2);
const src = campfireAudioCtx.createBufferSource(); src.buffer = buf;
const g = campfireAudioCtx.createGain(); g.gain.value = 0.4 + Math.random()*0.6;
src.connect(g); g.connect(master); src.start();
campfireCrackleNode = setTimeout(crackle, 90 + Math.random()*260);
}
crackle();
} catch(e) {}
}
function stopCampfireAmbiance() {
if (campfireEmberInterval) { clearInterval(campfireEmberInterval); campfireEmberInterval = null; }
const embers = document.getElementById('campfireEmbers'); if (embers) embers.innerHTML = '';
if (campfireCrackleNode) { clearTimeout(campfireCrackleNode); campfireCrackleNode = null; }
if (campfireAudioCtx) { try { campfireAudioCtx.close(); } catch(e) {} campfireAudioCtx = null; }
}
function toggleCallMic() {
if (!activeCall || !activeCall.localStream) return;
activeCall.mutedMic = !activeCall.mutedMic;
activeCall.localStream.getAudioTracks().forEach(t => t.enabled = !activeCall.mutedMic);
const btn = document.getElementById('callBtnMic');
btn.classList.toggle('muted', activeCall.mutedMic);
btn.textContent = activeCall.mutedMic ? '🔇' : '🎤';
}
function toggleCallCam() {
if (!activeCall || !activeCall.localStream || activeCall.type !== 'video') return;
activeCall.mutedCam = !activeCall.mutedCam;
activeCall.localStream.getVideoTracks().forEach(t => t.enabled = !activeCall.mutedCam);
const btn = document.getElementById('callBtnCam');
btn.classList.toggle('muted', activeCall.mutedCam);
btn.textContent = activeCall.mutedCam ? '📷' : '📹';
}
function toggleCallSpeaker() { showToast('🔊 Altavoz (demo)', 'success'); }
let ringtoneInterval = null;
function playRingtone() {
try {
const ctx = new (window.AudioContext || window.webkitAudioContext)();
ringtoneInterval = setInterval(() => {
const o = ctx.createOscillator();
const g = ctx.createGain();
o.frequency.value = 440;
o.type = 'sine';
g.gain.setValueAtTime(0, ctx.currentTime);
g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
o.connect(g); g.connect(ctx.destination);
o.start(); o.stop(ctx.currentTime + 0.8);
}, 1500);
} catch(e) {}
}
function stopRingtone() { if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; } }

// ============================================================
// TASKS
// ============================================================
function addTask() {
const title = document.getElementById('taskTitle').value.trim();
const desc = document.getElementById('taskDesc').value.trim();
const date = document.getElementById('taskDate').value;
const time = document.getElementById('taskTime').value;
const category = document.getElementById('taskCategory').value;
const priority = document.getElementById('taskPriority').value;
const duration = parseInt(document.getElementById('taskDuration').value);
if (!title) { showToast('Ingresa un título', 'error'); return; }
if (!date) { showToast('Selecciona una fecha', 'error'); return; }
const tasks = getTasks();
tasks.push({ id: 'task_' + Date.now(), userId: currentUser.id, title, desc, date, time, category, priority, duration, completed: false, createdAt: new Date().toISOString() });
saveTasks(tasks);
document.getElementById('taskTitle').value = ''; document.getElementById('taskDesc').value = ''; document.getElementById('taskTime').value = '';
renderTasks(); updateDashboard(); updateStreak();
addXP(10, '📋 Tarea creada');
showToast('✅ Tarea agregada (+10 XP)', 'success');
}
function renderTasks() {
const tasks = getTasks();
const search = (document.getElementById('taskSearch')?.value || '').toLowerCase();
let filtered = tasks;
if (currentFilter === 'pending') filtered = tasks.filter(t => !t.completed);
else if (currentFilter === 'completed') filtered = tasks.filter(t => t.completed);
else if (['alta','media','baja'].includes(currentFilter)) filtered = tasks.filter(t => t.priority === currentFilter);
else if (currentFilter !== 'all') filtered = tasks.filter(t => t.category === currentFilter);
if (search) filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || (t.desc && t.desc.toLowerCase().includes(search)));
filtered.sort((a, b) => { if (a.completed !== b.completed) return a.completed ? 1 : -1; const pOrder = { alta: 0, media: 1, baja: 2 }; return pOrder[a.priority] - pOrder[b.priority]; });
const list = document.getElementById('taskList');
if (filtered.length === 0) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>No hay tareas</h3></div>'; return; }
const catNames = { trabajo: '💼 Trabajo', personal: '🏠 Personal', salud: '❤️ Salud', estudio: '📚 Estudio', hogar: '🏡 Hogar', otro: '📌 Otro' };
const pIcons = { baja: '🟢', media: '🟡', alta: '🔴' };
const pending = tasks.filter(t => !t.completed).length;
const badge = document.getElementById('taskBadge');
badge.textContent = pending;
badge.style.display = pending > 0 ? 'inline' : 'none';
list.innerHTML = filtered.map(task => {
const dateObj = new Date(task.date + 'T00:00:00');
const dateStr = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const isOverdue = !task.completed && new Date(task.date + ' ' + (task.time||'23:59')) < new Date();
return `<li class="task-item ${task.completed?'completed':''}" style="${isOverdue?'border-left:3px solid var(--danger);':''}">
<div class="task-checkbox ${task.completed?'checked':''}" onclick="toggleTask('${task.id}')">${task.completed?'✓':''}</div>
<div class="task-info">
<div class="task-title">${task.title}</div>
<div class="task-meta">
<span>📅 ${dateStr}</span>
${task.time?'<span>🕐 '+task.time+'</span>':''}
${task.duration?'<span>⏱️ '+task.duration+'min</span>':''}
<span class="task-badge badge-${task.category}">${catNames[task.category]}</span>
<span>${pIcons[task.priority]} ${task.priority}</span>
${isOverdue?'<span style="color:var(--danger);font-weight:600">⚠️ Vencida</span>':''}
</div>
${task.desc?'<div style="font-size:0.82em;color:var(--text-light);margin-top:3px">'+task.desc+'</div>':''}
</div>
<div class="task-actions">
<button class="task-chat-btn ${taskHasRoutineChatUnread(task.id)?'has-unread':''}" onclick="openOrLinkTaskCapsule('${task.id}')" title="Chat de esta rutina"><span class="tcb-dot"></span>${taskHasRoutineChat(task.id)?'🌱':'💬'}</button>
<button onclick="editTask('${task.id}')">✏️</button>
<button class="delete-btn" onclick="deleteTask('${task.id}')">🗑️</button>
</div>
</li>`;
}).join('');
}
function toggleTask(id) {
const tasks = getTasks();
const task = tasks.find(t => t.id === id);
if (task) {
task.completed = !task.completed;
if (task.completed) { task.completedAt = new Date().toISOString(); addXP(15, '✅ Tarea completada'); updateStreak(); awardAiToken(); }
else { delete task.completedAt; }
saveTasks(tasks); renderTasks(); updateDashboard(); checkAchievements();
if (task.completed && taskHasRoutineChat(id)) { confirmRoutineActionForTask(id, 'Rutina sincronizada'); harvestRoutineThread(id); }
}
}
// ============================================================
// TOKENS DE IA — se ganan completando tareas, tope de 10, y se
// gastan únicamente al hablar con el Asistente Sv
// ============================================================
const AI_TOKEN_MAX = 10;
function getAiTokens() { const habits = getHabits(); return Math.min(AI_TOKEN_MAX, Math.max(0, habits.aiTokens || 0)); }
function setAiTokens(n) { const habits = getHabits(); habits.aiTokens = Math.min(AI_TOKEN_MAX, Math.max(0, n)); saveHabits(habits); renderAiTokenBar(); }
function awardAiToken(amount = 1) {
const before = getAiTokens();
if (before >= AI_TOKEN_MAX) { return; }
setAiTokens(before + amount);
showToast(`🔋 +${amount} token de IA (${getAiTokens()}/${AI_TOKEN_MAX})`, 'success');
}
function spendAiToken() {
const current = getAiTokens();
if (current <= 0) return false;
setAiTokens(current - 1);
return true;
}
function renderAiTokenBar() {
const bar = document.getElementById('aiTokenBar');
if (!bar) return;
const tokens = getAiTokens();
const pct = (tokens / AI_TOKEN_MAX) * 100;
bar.innerHTML = `<div class="ai-token-row"><span>🔋 Tokens de IA</span><span>${tokens}/${AI_TOKEN_MAX}</span></div><div class="ai-token-track"><div class="ai-token-fill" style="width:${pct}%"></div></div><div class="ai-token-hint">${tokens > 0 ? 'Cada tarea completada te da +1 token (máx. ' + AI_TOKEN_MAX + ')' : '⚠️ Sin tokens — completa una tarea para ganar hasta ' + AI_TOKEN_MAX}</div>`;
const input = document.getElementById('chatInput');
const btn = document.querySelector('.chat-send-btn');
if (input) input.disabled = tokens <= 0;
if (btn) btn.disabled = tokens <= 0;
}
function editTask(id) {
const task = getTasks().find(t => t.id === id); if (!task) return;
document.getElementById('editTaskId').value = id;
document.getElementById('editTaskTitle').value = task.title;
document.getElementById('editTaskDesc').value = task.desc||'';
document.getElementById('editTaskDate').value = task.date;
document.getElementById('editTaskTime').value = task.time||'';
document.getElementById('editTaskCategory').value = task.category;
document.getElementById('editTaskPriority').value = task.priority;
document.getElementById('editTaskModal').classList.add('show');
}
function saveTaskEdit() {
const id = document.getElementById('editTaskId').value;
const tasks = getTasks();
const task = tasks.find(t => t.id === id); if (!task) return;
task.title = document.getElementById('editTaskTitle').value.trim();
task.desc = document.getElementById('editTaskDesc').value.trim();
task.date = document.getElementById('editTaskDate').value;
task.time = document.getElementById('editTaskTime').value;
task.category = document.getElementById('editTaskCategory').value;
task.priority = document.getElementById('editTaskPriority').value;
if (!task.title) { showToast('Título obligatorio', 'error'); return; }
saveTasks(tasks); closeModal('editTaskModal'); renderTasks(); updateDashboard();
showToast('✅ Tarea actualizada', 'success');
}
function deleteTask(id) { if (!confirm('¿Eliminar tarea?')) return; saveTasks(getTasks().filter(t => t.id !== id)); renderTasks(); updateDashboard(); showToast('🗑️ Eliminado', 'warning'); }
function deleteOverdueTasks() {
const tasks = getTasks();
const now = new Date();
const overdue = tasks.filter(t => !t.completed && new Date(t.date + ' ' + (t.time||'23:59')) < now);
if (overdue.length === 0) { showToast('No tienes tareas vencidas', 'success'); return; }
if (!confirm(`¿Eliminar ${overdue.length} tarea(s) vencida(s)?`)) return;
const overdueIds = new Set(overdue.map(t => t.id));
saveTasks(tasks.filter(t => !overdueIds.has(t.id)));
renderTasks(); updateDashboard();
showToast(`🗑️ ${overdue.length} tarea(s) eliminada(s)`, 'warning');
}
function deleteAllTasks() {
const tasks = getTasks();
if (tasks.length === 0) { showToast('No tienes tareas', 'success'); return; }
if (!confirm(`¿Eliminar TODAS tus ${tasks.length} tarea(s)?`)) return;
saveTasks([]); renderTasks(); updateDashboard();
showToast('🗑️ Todas eliminadas', 'warning');
}
function filterTasks(f, el) { currentFilter = f; document.querySelectorAll('#page-tasks .chip').forEach(c => c.classList.remove('active')); if (el) el.classList.add('active'); renderTasks(); }
function aiAutoSchedule() {
const tasks = getTasks().filter(t => !t.completed && !t.time);
if (tasks.length === 0) { showToast('No hay tareas sin hora', 'warning'); return; }
const timeSlots = { morning: ['06:00','07:00','08:00','09:00','10:00','11:00'], afternoon: ['12:00','13:00','14:00','15:00','16:00','17:00'], evening: ['18:00','19:00','20:00'] };
const categoryTimes = { trabajo: timeSlots.morning, estudio: timeSlots.morning, salud: ['06:00','07:00','18:00','19:00'], personal: timeSlots.afternoon, hogar: timeSlots.afternoon, otro: timeSlots.evening };
let slotIndex = {};
tasks.forEach(task => { const slots = categoryTimes[task.category] || timeSlots.afternoon; const idx = slotIndex[task.category] || 0; task.time = slots[idx % slots.length]; slotIndex[task.category] = idx + 1; });
saveTasks(tasks); renderTasks(); addXP(20, '🤖 Auto-agendado');
showToast('🤖 ' + tasks.length + ' tareas agendadas (+20 XP)', 'success');
}
// ============================================================
// GESTOR DE TIEMPO — analiza patrones y sugiere mejores rutinas
// ============================================================
const TM_CAT_ICONS = { trabajo:'💼', salud:'❤️', personal:'💜', estudio:'📚', hogar:'🏡', otro:'📌' };
const TM_BUCKETS = [
{ key: 'madrugada', label: '🌌 Madrugada', range: [0,5], slots: ['00:00','02:00','04:00'] },
{ key: 'manana', label: '🌅 Mañana', range: [5,12], slots: ['06:00','07:00','08:00','09:00','10:00','11:00'] },
{ key: 'tarde', label: '☀️ Tarde', range: [12,18], slots: ['12:00','13:00','14:00','15:00','16:00','17:00'] },
{ key: 'noche', label: '🌙 Noche', range: [18,24], slots: ['18:00','19:00','20:00','21:00','22:00'] }
];
function tmBucketForHour(h) { return TM_BUCKETS.find(b => h >= b.range[0] && h < b.range[1]) || TM_BUCKETS[1]; }
function analyzeTimePatterns() {
const tasks = getTasks();
const completed = tasks.filter(t => t.completed && t.completedAt);
const byCategory = {};
tasks.forEach(t => { if (!byCategory[t.category]) byCategory[t.category] = { total: 0, done: 0 }; byCategory[t.category].total++; if (t.completed) byCategory[t.category].done++; });
const bucketCounts = { madrugada: 0, manana: 0, tarde: 0, noche: 0 };
completed.forEach(t => { const h = new Date(t.completedAt).getHours(); bucketCounts[tmBucketForHour(h).key]++; });
let bestBucketKey = 'manana', bestCount = -1;
Object.entries(bucketCounts).forEach(([k,v]) => { if (v > bestCount) { bestCount = v; bestBucketKey = k; } });
const bestBucket = TM_BUCKETS.find(b => b.key === bestBucketKey);
let bestCategory = null, bestRate = -1;
Object.entries(byCategory).forEach(([cat, s]) => { if (s.total >= 2) { const rate = s.done / s.total; if (rate > bestRate) { bestRate = rate; bestCategory = cat; } } });
return { byCategory, bucketCounts, bestBucket, bestCategory, bestRate, totalCompleted: completed.length, totalTasks: tasks.length };
}
function renderTimeManager() {
const analysis = analyzeTimePatterns();
const summary = document.getElementById('timePatternsSummary');
const streak = getStreak();
const energyLvl = computeEnergyLevel(currentUser.id);
if (analysis.totalCompleted < 3) {
summary.innerHTML = `<p style="color:var(--text-light);font-size:0.9em">Completa al menos 3 tareas para que pueda detectar tus patrones reales. Por ahora, aquí tienes un horario sugerido con base en prioridades.</p>`;
} else {
summary.innerHTML = `<div class="stats-grid" style="margin:0">
<div class="stat-card"><div class="stat-icon">${analysis.bestBucket.label.split(' ')[0]}</div><div class="stat-value" style="font-size:1em">${analysis.bestBucket.label.split(' ')[1]}</div><div class="stat-label">Tu momento más productivo</div></div>
<div class="stat-card"><div class="stat-icon">${TM_CAT_ICONS[analysis.bestCategory]||'📌'}</div><div class="stat-value" style="font-size:1em">${analysis.bestCategory||'—'}</div><div class="stat-label">Categoría con mejor racha</div></div>
<div class="stat-card"><div class="stat-icon">🔥</div><div class="stat-value">${streak}</div><div class="stat-label">Días de racha</div></div>
<div class="stat-card"><div class="stat-icon">${ENERGY_META[energyLvl].icon}</div><div class="stat-value" style="font-size:1em">${ENERGY_META[energyLvl].label}</div><div class="stat-label">Energía de hoy</div></div>
</div>`;
}
const today = new Date().toISOString().split('T')[0];
let pending = getTasks().filter(t => !t.completed && (t.date === today || !t.date));
if (pending.length === 0) pending = getTasks().filter(t => !t.completed).slice(0, 6);
const scheduleEl = document.getElementById('suggestedSchedule');
if (pending.length === 0) { scheduleEl.innerHTML = '<p style="color:var(--text-light);font-size:0.9em">No tienes tareas pendientes. ¡Agrega algunas en "Mis Tareas" para recibir un horario sugerido!</p>'; return; }
const priorityRank = { alta: 0, media: 1, baja: 2 };
pending.sort((a,b) => (priorityRank[a.priority]??1) - (priorityRank[b.priority]??1));
const orderedBuckets = [analysis.bestBucket, ...TM_BUCKETS.filter(b => b.key !== analysis.bestBucket.key)];
let slotPool = [];
orderedBuckets.forEach(b => slotPool.push(...b.slots.map(s => ({ time: s, bucket: b.key }))));
scheduleEl.innerHTML = pending.map((task, i) => {
const slot = slotPool[i % slotPool.length];
return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0">
<div style="font-weight:700;color:var(--primary);min-width:52px">${slot.time}</div>
<span style="font-size:1.2em">${TM_CAT_ICONS[task.category]||'📌'}</span>
<div style="flex:1"><div style="font-weight:600;font-size:0.92em">${escapeHtml(task.title)}</div><div style="font-size:0.78em;color:var(--text-light)">Prioridad ${task.priority}${slot.bucket===analysis.bestBucket.key?' · en tu mejor momento ⭐':''}</div></div>
</div>`;
}).join('');
}
async function requestAiRoutineSuggestion() {
if (getAiTokens() <= 0) { document.getElementById('aiRoutineSuggestion').innerHTML = '<p style="color:var(--danger);font-size:0.88em">🔋 No te quedan tokens de IA. Completa una tarea para ganar hasta ' + AI_TOKEN_MAX + '.</p>'; return; }
const btn = document.getElementById('aiRoutineBtn');
btn.disabled = true; btn.textContent = '⏳ Analizando...';
spendAiToken();
const analysis = analyzeTimePatterns();
const tasks = getTasks();
const level = getUserLevel();
const streak = getStreak();
const catSummary = Object.entries(analysis.byCategory).map(([c,s]) => `${c}: ${s.done}/${s.total} completadas`).join(', ');
const systemPrompt = `Eres el Gestor de Tiempo de Rutinas-Sv. Con estos datos del usuario, sugiere una rutina diaria breve y concreta (máximo 6 bloques de horario), en español, en formato de lista simple "HH:MM - actividad". Sé motivador pero breve.`;
const userMsg = `Nivel: ${level.level}. Racha: ${streak} días. Categorías: ${catSummary || 'sin datos suficientes'}. Momento más productivo detectado: ${analysis.bestBucket.label}. Tareas pendientes: ${tasks.filter(t=>!t.completed).map(t=>t.title+' ('+t.category+', prioridad '+t.priority+')').join('; ') || 'ninguna'}.`;
try {
const reply = await callAiProvider(systemPrompt, [{ role: 'user', content: userMsg }]);
document.getElementById('aiRoutineSuggestion').innerHTML = `<div class="ai-token-bar" style="background:var(--bg)">${reply.replace(/\n/g,'<br>')}</div>`;
addXP(5, '⏱️ Rutina sugerida por IA');
const habits = getHabits(); habits.timeManagerUsed = true; saveHabits(habits); checkAchievements();
} catch (e) {
document.getElementById('aiRoutineSuggestion').innerHTML = '<p style="color:var(--danger);font-size:0.88em">No se pudo generar la sugerencia. Intenta de nuevo.</p>';
}
btn.disabled = false; btn.textContent = '🔋 Pedir sugerencia (1 token)';
renderAiTokenBar();
}

// ============================================================
// AI CHAT
// ============================================================
let chatHistory = [];
async function sendMessage() {
const input = document.getElementById('chatInput');
const msg = input.value.trim();
if (!msg) return;
if (getAiTokens() <= 0) {
addChatMessage('🔋 No te quedan tokens de IA. Completa una tarea en "Mis Tareas" para ganar hasta ' + AI_TOKEN_MAX + ' tokens.', 'bot');
return;
}
addChatMessage(msg, 'user');
input.value = '';
spendAiToken();
const habits = getHabits();
habits.aiMessages = (habits.aiMessages || 0) + 1;
saveHabits(habits);
checkAchievements();
const container = document.getElementById('chatMessages');
const typing = document.createElement('div');
typing.className = 'chat-message bot';
typing.id = 'typingIndicator';
typing.innerHTML = '<div class="chat-avatar"></div><div class="chat-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
container.appendChild(typing);
container.scrollTop = container.scrollHeight;
const tasks = getTasks();
const expenses = getExpenses();
const level = getUserLevel();
const streak = getStreak();
const totalSpent = expenses.reduce((s,e) => s + e.amount, 0);
const remaining = getWalletLimit() - totalSpent;
const today = new Date().toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
const systemPrompt = `Eres "Asistente Sv", la IA personal de Rutinas-Sv. DATOS: Nombre: ${currentUser?.username}. Nivel: ${level.level} (${level.name}). Racha: ${streak} días. Tareas: ${tasks.filter(t=>t.completed).length}/${tasks.length}. Presupuesto: $${remaining.toFixed(2)}. Fecha: ${today}. Responde en español, conciso y útil.`;
chatHistory.push({ role: 'user', content: msg });
if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
try {
const reply = await callAiProvider(systemPrompt, chatHistory);
const t = document.getElementById('typingIndicator'); if (t) t.remove();
addChatMessage(reply, 'bot');
chatHistory.push({ role: 'assistant', content: reply });
addXP(2, '🤖 Chat con IA');
} catch (err) {
const t = document.getElementById('typingIndicator'); if (t) t.remove();
addChatMessage(getLocalAIResponse(msg), 'bot');
}
}
// ---- proveedor de IA: Gemini (si hay API key configurada) con Claude como respaldo ----
function getAiProviderSettings() { const db = getDB(); return (db.settings && db.settings.ai) || { provider: 'auto', geminiApiKey: '', geminiModel: 'gemini-2.0-flash' }; }
async function callAiProvider(systemPrompt, history) {
const cfg = getAiProviderSettings();
if (cfg.provider === 'gemini' && cfg.geminiApiKey) {
try { return await callGeminiAPI(systemPrompt, history, cfg); }
catch (e) { return await callAnthropicAPI(systemPrompt, history); }
}
return await callAnthropicAPI(systemPrompt, history);
}
async function callAnthropicAPI(systemPrompt, history) {
const response = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, system: systemPrompt, messages: history })
});
const data = await response.json();
return data.content?.map(c => c.text || '').join('') || 'Error al procesar.';
}
async function callGeminiAPI(systemPrompt, history, cfg) {
const model = (cfg && cfg.geminiModel) || 'gemini-2.0-flash';
const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.geminiApiKey)}`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { maxOutputTokens: 800 } })
});
const data = await response.json();
if (data.error) throw new Error(data.error.message || 'Error de Gemini');
const parts = data.candidates?.[0]?.content?.parts || [];
const text = parts.map(p => p.text || '').join('');
if (!text) throw new Error('Respuesta vacía de Gemini');
return text;
}
function saveAiProviderSettings() {
const provider = document.getElementById('aiProviderSelect').value;
const geminiApiKey = document.getElementById('geminiApiKeyInput').value.trim();
const db = getDB();
if (!db.settings) db.settings = {};
db.settings.ai = { provider, geminiApiKey, geminiModel: 'gemini-2.0-flash' };
saveDB(db);
showToast(provider === 'gemini' ? '✅ Gemini configurado como motor de IA' : '✅ Motor de IA guardado', 'success');
}
function renderAiProviderSettings() {
const cfg = getAiProviderSettings();
const sel = document.getElementById('aiProviderSelect');
const key = document.getElementById('geminiApiKeyInput');
if (sel) sel.value = cfg.provider || 'auto';
if (key) key.value = cfg.geminiApiKey || '';
}
function getLocalAIResponse(msg) {
const m = msg.toLowerCase();
if (/hola|hey|buenos/.test(m)) return '¡Hola! 👋 Soy Asistente Sv. ¿En qué te ayudo?';
if (/horario|cuando|mejor momento/.test(m)) return '🕐 Te sugiero: trabajo profundo 6-10 AM, reuniones 10-12, descanso 12-14, tareas admin 14-17, ejercicio 17-19.';
if (/productividad|pomodoro/.test(m)) return '⚡ Técnica Pomodoro: 25 min trabajo + 5 min descanso.';
const tasks = getTasks(); const done = tasks.filter(t=>t.completed).length;
if (/progreso|estadistica|como voy/.test(m)) return `📊 Tienes ${done}/${tasks.length} tareas completadas. Nivel ${getUserLevel().level}.`;
return '🌿 Puedo ayudarte con horarios, productividad, salud, finanzas y más.';
}
function addChatMessage(text, type) {
const container = document.getElementById('chatMessages');
const div = document.createElement('div');
div.className = 'chat-message ' + type;
const avatar = type === 'bot' ? '🌿' : currentUser.username.charAt(0).toUpperCase();
let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
div.innerHTML = '<div class="chat-avatar">' + avatar + '</div><div class="chat-bubble">' + formatted + '</div>';
container.appendChild(div);
container.scrollTop = container.scrollHeight;
}

// ============================================================
// PLANS GENERATOR
// ============================================================
function selectPlanType(type, el) { currentPlanType = type; document.querySelectorAll('.plan-gen-option').forEach(o => o.classList.remove('selected')); if (el) el.classList.add('selected'); }
function generatePlan() {
const btn = document.querySelector('#page-plans .btn.btn-primary');
if (btn) { btn.disabled = true; btn.textContent = '⟳ Generando...'; }
const tasks = getTasks().filter(t => !t.completed);
const expenses = getExpenses();
const remaining = getWalletLimit() - expenses.reduce((s,e) => s + e.amount, 0);
const level = getUserLevel();
const streak = getStreak();
const today = new Date().toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
const typeNames = { daily:'plan diario', weekly:'plan semanal', productivity:'plan de productividad', balanced:'plan equilibrado' };
const typeName = typeNames[currentPlanType] || 'plan diario';
const tasksList = tasks.slice(0,8).map(t => `• ${t.title} [${t.category}, ${t.priority}]`).join('\n') || '• Sin tareas pendientes';
const prompt = `Crea un ${typeName} en español. DATOS: Fecha: ${today}. Nivel: ${level.level}, ${level.xp} XP, ${streak} días racha. Presupuesto: $${remaining.toFixed(2)}. Tareas:\n${tasksList}\nResponde JSON: {"title":"Título","summary":"Resumen","items":[{"time":"HH:MM","activity":"Nombre","detail":"Descripción","type":"work|break|routine|health","energy":"alta|media|baja"}]}. Incluye 8-14 items.`;
const container = document.getElementById('planResult');
container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light)"><div style="font-size:2em;margin-bottom:10px">🤖</div><p>Generando plan...</p></div>';
fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: 'Eres un planificador experto. Responde JSON puro.', messages: [{ role: 'user', content: prompt }] })
}).then(r => r.json()).then(data => {
const raw = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g,'').trim();
const plan = JSON.parse(raw);
const db = getDB(); if (!db.plans) db.plans = [];
const savedPlan = { id:'plan_'+Date.now(), userId: currentUser.id, type: currentPlanType, title: plan.title, summary: plan.summary, items: plan.items, createdAt: new Date().toISOString() };
db.plans.push(savedPlan); saveDB(db);
addXP(30, '📝 Plan IA'); checkAchievements();
renderPlanResult(savedPlan); savePlanAsTasks();
showToast('📝 Plan generado (+30 XP)', 'success');
}).catch(() => { generatePlanLocal(); }).finally(() => { if (btn) { btn.disabled = false; btn.textContent = '🤖 Generar Plan con IA'; } });
}
function generatePlanLocal() {
const tasks = getTasks().filter(t => !t.completed);
const items = [
{ time:'06:00', activity:'🌅 Despertar', detail:'Rutina matutina', type:'routine', energy:'baja' },
{ time:'06:30', activity:'🏃 Ejercicio', detail:'30 min', type:'health', energy:'alta' },
{ time:'08:00', activity:'🧠 Trabajo profundo', detail: tasks.filter(t=>t.priority==='alta').map(t=>t.title).slice(0,2).join(', ') || 'Tareas prioritarias', type:'work', energy:'alta' },
{ time:'10:00', activity:'☕ Descanso', detail:'15 min', type:'break', energy:'baja' },
{ time:'12:00', activity:'🍽️ Almuerzo', detail:'Descanso', type:'break', energy:'baja' },
{ time:'15:00', activity:'💼 Trabajo', detail:'Tareas pendientes', type:'work', energy:'media' },
{ time:'18:00', activity:'🚶 Caminata', detail:'Ejercicio ligero', type:'health', energy:'media' },
{ time:'21:30', activity:'🌙 Dormir', detail:'Rutina nocturna', type:'routine', energy:'baja' }
];
const plan = { id:'plan_'+Date.now(), userId: currentUser.id, type: currentPlanType, title: '📅 Plan '+new Date().toLocaleDateString('es-ES'), summary: 'Plan generado localmente.', items, createdAt: new Date().toISOString() };
const db = getDB(); if (!db.plans) db.plans = []; db.plans.push(plan); saveDB(db);
addXP(20, '📝 Plan'); checkAchievements();
renderPlanResult(plan); savePlanAsTasks();
showToast('📝 Plan generado (+20 XP)', 'success');
}
function renderPlanResult(plan) {
const container = document.getElementById('planResult');
const typeColors = { work:'#4361ee', break:'#2a9d8f', routine:'#e9c46a', health:'#e76f51' };
const items = plan.items || [];
container.innerHTML = `<div class="plan-card animate-fade">
<div class="plan-header"><h3>${plan.title || '📝 Plan'}</h3><span style="font-size:0.82em;color:var(--text-light)">${new Date(plan.createdAt).toLocaleString('es-ES')}</span></div>
${plan.summary ? `<p style="font-size:0.88em;color:var(--text-light);margin-bottom:14px;font-style:italic">${plan.summary}</p>` : ''}
<div class="plan-timeline">
${items.map(item => `<div class="plan-item" style="border-left:3px solid ${typeColors[item.type]||'#999'}">
<div class="plan-time">${item.time}</div>
<div style="flex:1"><div class="plan-task">${item.activity}</div>
${item.detail ? `<div style="font-size:0.78em;color:var(--text-light);margin-top:2px">${item.detail}</div>` : ''}
</div></div>`).join('')}
</div></div>`;
window._lastPlan = plan;
}
function savePlanAsTasks() {
const plan = window._lastPlan;
if (!plan) return;
const items = plan.items || [];
const today = new Date().toISOString().split('T')[0];
const tasks = getTasks();
items.forEach(item => {
const isRest = item.type === 'break' || item.type === 'routine';
tasks.push({ id:'task_'+Date.now()+Math.random(), userId:currentUser.id, title:item.activity, desc:item.detail||'', date:today, time:item.time, category: item.type==='health'?'salud':(isRest?'personal':'trabajo'), priority: isRest?'baja':'media', duration:30, completed:false, fromPlan:true, createdAt:new Date().toISOString() });
});
saveTasks(tasks); updateDashboard();
}
function renderSavedPlans() {
const db = getDB();
const plans = (db.plans || []).filter(p => p.userId === currentUser?.id).reverse().slice(0, 5);
const container = document.getElementById('savedPlans');
if (plans.length === 0) { container.innerHTML = ''; return; }
container.innerHTML = '<div class="card"><h3 class="card-title" style="margin-bottom:14px">📋 Planes Guardados</h3>' + plans.map(p => {
const typeNames = { daily: '📅 Diario', weekly: '📆 Semanal', productivity: '⚡ Productividad', balanced: '⚖️ Equilibrado' };
return `<div style="padding:12px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:8px;cursor:pointer" onclick='renderPlanResult(${JSON.stringify(p).replace(/'/g,"&#39;")})'><strong>${typeNames[p.type] || '📝 Plan'}</strong><br><span style="font-size:0.82em;color:var(--text-light)">${(p.items||[]).length} actividades • ${new Date(p.createdAt).toLocaleDateString('es-ES')}</span></div>`;
}).join('') + '</div>';
}

// ============================================================
// WALLET
// ============================================================
function confirmBudgetSetup() {
const val = parseFloat(document.getElementById('budgetSetupInput').value);
if (!val || val <= 0) { showToast('Monto inválido', 'error'); return; }
setWalletLimit(val);
updateWallet(); renderExpenses();
}
function openBudgetEdit() {
const current = getWalletLimit();
const val = prompt('Nuevo presupuesto ($):', current > 0 ? current : '');
if (val === null) return;
const num = parseFloat(val);
if (!num || num <= 0) { showToast('Monto inválido', 'error'); return; }
setWalletLimit(num);
}
function updateWallet() {
const limit = getWalletLimit();
const expenses = getExpenses();
const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
const remaining = limit - totalSpent;
const percent = limit > 0 ? Math.max(0, (remaining / limit) * 100) : 0;
const today = new Date().toISOString().split('T')[0];
const todaySpent = expenses.filter(e => e.date === today).reduce((s, e) => s + e.amount, 0);
const setupCard = document.getElementById('walletSetupCard');
const mainContent = document.getElementById('walletMainContent');
if (limit <= 0) {
if (setupCard) setupCard.style.display = 'block';
if (mainContent) mainContent.style.display = 'none';
document.getElementById('walletMiniAmount').textContent = 'Sin límite';
document.getElementById('statWallet').textContent = '$0';
return;
}
if (setupCard) setupCard.style.display = 'none';
if (mainContent) mainContent.style.display = 'block';
document.getElementById('walletBalance').textContent = '$' + remaining.toFixed(2);
document.getElementById('walletTotalSpent').textContent = '$' + totalSpent.toFixed(2);
document.getElementById('walletExpenseCount').textContent = expenses.length;
document.getElementById('walletTodaySpent').textContent = '$' + todaySpent.toFixed(2);
document.getElementById('walletProgressBar').style.width = percent + '%';
document.getElementById('walletPercentLabel').textContent = percent.toFixed(1) + '% disponible';
const totalLabelEl = document.getElementById('walletTotalLabel');
if (totalLabelEl) totalLabelEl.textContent = '$' + limit.toFixed(2) + ' total';
document.getElementById('walletMiniAmount').textContent = '$' + remaining.toFixed(2);
const mainCard = document.getElementById('walletMainCard');
const alertEl = document.getElementById('walletAlertLevel');
if (percent <= 0) { mainCard.style.background = 'linear-gradient(135deg,#e76f51,#d00000)'; alertEl.innerHTML = '🚫 AGOTADO'; }
else if (percent <= 10) { mainCard.style.background = 'linear-gradient(135deg,#e76f51,#f4a261)'; alertEl.innerHTML = '🚨 <10%'; }
else if (percent <= 20) { mainCard.style.background = 'linear-gradient(135deg,#f4a261,#e9c46a)'; alertEl.innerHTML = '⚠️ <20%'; }
else { mainCard.style.background = 'linear-gradient(135deg,#e9c46a,#f4a261,#e76f51)'; alertEl.innerHTML = '✅ OK'; }
document.getElementById('statWallet').textContent = '$' + remaining.toFixed(0);
}
function addExpense() {
const limit = getWalletLimit();
if (limit <= 0) { showToast('⚠️ Configura tu presupuesto', 'warning'); return; }
const amount = parseFloat(document.getElementById('expenseAmount').value);
const desc = document.getElementById('expenseDesc').value.trim();
const category = document.getElementById('expenseCategory').value;
if (!amount || amount <= 0) { showToast('Monto inválido', 'error'); return; }
if (!desc) { showToast('Agrega descripción', 'error'); return; }
const expenses = getExpenses();
const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
if (totalSpent + amount > limit) { showToast('⚠️ Excede presupuesto', 'error'); return; }
expenses.push({ id: 'exp_' + Date.now(), userId: currentUser.id, amount, description: desc, category, date: new Date().toISOString().split('T')[0], time: new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}), ticket: capturedTicketData || null, createdAt: new Date().toISOString() });
saveExpenses(expenses);
document.getElementById('expenseAmount').value = '';
document.getElementById('expenseDesc').value = '';
capturedTicketData = null;
document.getElementById('ticketPreview').style.display = 'none';
updateWallet(); renderExpenses();
addXP(5, '💸 Gasto');
showToast('💸 Gasto: $' + amount.toFixed(2), 'success');
checkAchievements();
}
function renderExpenses() {
const expenses = getExpenses();
const search = (document.getElementById('expenseSearch')?.value || '').toLowerCase();
let filtered = expenses;
if (currentExpenseFilter !== 'all') filtered = expenses.filter(e => e.category === currentExpenseFilter);
if (search) filtered = filtered.filter(e => e.description.toLowerCase().includes(search));
filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const container = document.getElementById('expenseList');
if (filtered.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">🧾</div><h3>Sin gastos</h3></div>'; return; }
const cIcons = { alimentacion:'🍔', transporte:'🚗', entretenimiento:'🎮', 'salud-cat':'💊', ropa:'👕', 'hogar-cat':'🏠', educacion:'📚', 'otro-cat':'📌' };
container.innerHTML = filtered.map(exp => {
const dateObj = new Date(exp.date + 'T00:00:00');
return `<div class="expense-item">
<div class="expense-icon cat-${exp.category}">${cIcons[exp.category]||''}</div>
<div class="expense-info">
<div class="expense-desc">${exp.description}</div>
<div class="expense-amount">-$${exp.amount.toFixed(2)}</div>
<div class="expense-date">📅 ${dateObj.toLocaleDateString('es-ES',{day:'numeric',month:'short'})} • 🕐 ${exp.time||''}</div>
</div>
<button class="btn btn-danger btn-sm" onclick="deleteExpense('${exp.id}')" style="padding:6px 10px;font-size:0.8em">🗑️</button>
</div>`;
}).join('');
}
function filterExpenses(f, el) { currentExpenseFilter = f; document.querySelectorAll('#expenseFilterChips .chip').forEach(c => c.classList.remove('active')); if (el) el.classList.add('active'); renderExpenses(); }
function deleteExpense(id) { if (!confirm('¿Eliminar gasto?')) return; saveExpenses(getExpenses().filter(e => e.id !== id)); updateWallet(); renderExpenses(); showToast('🗑️ Eliminado', 'warning'); }
function exportExpenses() {
const expenses = getExpenses();
let csv = 'Fecha,Hora,Descripción,Categoría,Monto\n';
expenses.forEach(e => { const cn = { alimentacion:'Alimentación', transporte:'Transporte', entretenimiento:'Entretenimiento', 'salud-cat':'Salud', ropa:'Ropa', 'hogar-cat':'Hogar', educacion:'Educación', 'otro-cat':'Otro' }; csv += `${e.date},${e.time||''},"${e.description}",${cn[e.category]||e.category},$${e.amount.toFixed(2)}\n`; });
const blob = new Blob([csv], { type: 'text/csv' });
const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cartera-sv-' + new Date().toISOString().split('T')[0] + '.csv'; a.click();
showToast('📥 Exportado', 'success');
}
async function startCamera() { try { if (cameraStream) stopCamera(); cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode }, audio: false }); document.getElementById('cameraVideo').srcObject = cameraStream; document.getElementById('cameraPreview').style.display = 'block'; document.getElementById('cameraControls').style.display = 'flex'; showToast('📷 Cámara activada', 'success'); } catch(e) { showToast('No se pudo acceder a la cámara', 'error'); } }
function stopCamera() { if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; } const v = document.getElementById('cameraVideo'); if (v) v.srcObject = null; const p = document.getElementById('cameraPreview'); if (p) p.style.display = 'none'; const c = document.getElementById('cameraControls'); if (c) c.style.display = 'none'; }
function switchCamera() { currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment'; stopCamera(); startCamera(); }
function captureTicket() { const video = document.getElementById('cameraVideo'); const canvas = document.getElementById('cameraCanvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); capturedTicketData = canvas.toDataURL('image/jpeg', 0.6); document.getElementById('ticketPreviewImg').src = capturedTicketData; document.getElementById('ticketPreview').style.display = 'block'; showToast('📸 Ticket capturado', 'success'); }
function handleTicketUpload(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); const scale = Math.min(1, 800 / img.width); canvas.width = img.width * scale; canvas.height = img.height * scale; canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); capturedTicketData = canvas.toDataURL('image/jpeg', 0.6); document.getElementById('ticketPreviewImg').src = capturedTicketData; document.getElementById('ticketPreview').style.display = 'block'; showToast('🖼️ Imagen cargada', 'success'); }; img.src = e.target.result; }; reader.readAsDataURL(file); event.target.value = ''; }

// ============================================================
// TIPS
// ============================================================
const allTips = {
productividad:["Pomodoro: 25min trabajo + 5min descanso","Planifica el día la noche anterior","Regla 80/20: 20% acciones = 80% resultados","Elimina distracciones","Divide proyectos en tareas pequeñas"],
salud:["8 vasos de agua diarios","30 min ejercicio diario","7-9 horas de sueño","Frutas y verduras","Evita azúcar refinada"],
bienestar:["Medita 10 min diarios","Tiempo naturaleza","Gratitud diaria","Sin redes 1h antes dormir","Música que te haga bien"],
motivacion:["\"El éxito es fracasar sin perder entusiasmo\"","Cada día es nueva oportunidad","\"El secreto es empezar\"","Persistencia transforma fracaso","No necesitas ser grande para empezar"],
tecnologia:["HTML, CSS, JavaScript","Contraseñas únicas + Bitwarden","2FA en todas cuentas","Backups automáticos","Sistema actualizado"],
finanzas:["Regla 50/30/20","Fondo emergencia 3-6 meses","Registro gastos","Evita deudas crédito","Educación financiera"],
relaciones:["Escucha activa","Expresa gratitud","Practica empatía","Honestidad","Tiempo calidad"],
aprendizaje:["Lee 20 min diarios","Técnica Feynman","Aprendizaje espaciado","Notas mano","Enseña lo aprendido"]
};
function getDailyTip() {
const today = new Date();
const dayOfYear = Math.floor((today - new Date(today.getFullYear(),0,0)) / (1000*60*60*24));
const cats = Object.keys(allTips);
const cat = cats[dayOfYear % cats.length];
return { category: cat, tip: allTips[cat][dayOfYear % allTips[cat].length], names: { productividad:'⚡ Productividad', salud:'❤️ Salud', bienestar:'🧘 Bienestar', motivacion:'🔥 Motivación', tecnologia:'💻 Tecnología', finanzas:'💰 Finanzas', relaciones:'🤝 Relaciones', aprendizaje:'📚 Aprendizaje' }};
}
function initTips() { tipsReadCount = (getDB().settings||{}).tipsRead || 0; }
function loadDailyTip() { const dt = getDailyTip(); document.getElementById('dashboardTipText').textContent = dt.tip; document.getElementById('dashboardTipCategory').textContent = dt.names[dt.category]; document.getElementById('tipsTipText').textContent = dt.tip; document.getElementById('tipsTipCategory').textContent = dt.names[dt.category]; }
function renderTips() {
const grid = document.getElementById('tipsGrid');
let tips = [];
const cats = currentTipFilter === 'all' ? Object.keys(allTips) : [currentTipFilter];
const names = { productividad:'⚡ Productividad', salud:'❤️ Salud', bienestar:'🧘 Bienestar', motivacion:'🔥 Motivación', tecnologia:'💻 Tecnología', finanzas:'💰 Finanzas', relaciones:'🤝 Relaciones', aprendizaje:'📚 Aprendizaje' };
const icons = { productividad:'⚡', salud:'❤️', bienestar:'🧘', motivacion:'🔥', tecnologia:'💻', finanzas:'💰', relaciones:'🤝', aprendizaje:'📚' };
cats.forEach(cat => { allTips[cat].forEach((tip, idx) => tips.push({category:cat, tip, index:idx, name:names[cat], icon:icons[cat]})); });
grid.innerHTML = tips.map(t => `<div class="tip-card" onclick="showTipDetail()"><div class="tip-icon">${t.icon}</div><div class="tip-title">${t.name} #${t.index+1}</div><div class="tip-desc">${t.tip.substring(0,80)}...</div><span class="tip-category">${t.name}</span></div>`).join('');
}
function filterTips(cat, el) { currentTipFilter = cat; document.querySelectorAll('#tipCategoryFilters .chip').forEach(c => c.classList.remove('active')); if (el) el.classList.add('active'); renderTips(); }
function showTipDetail() { const db = getDB(); if (!db.settings) db.settings = {}; db.settings.tipsRead = (db.settings.tipsRead||0) + 1; saveDB(db); tipsReadCount = db.settings.tipsRead; showToast('💡 Consejo leído', 'success'); addXP(3, '💡 Consejo'); }

// ============================================================
// ANALYTICS
// ============================================================
function renderAnalytics() {
const tasks = getTasks();
const habits = getHabits();
const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const weekData = [];
for (let i = 6; i >= 0; i--) {
const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
const completed = (habits.daily||{})[date] || 0;
weekData.push({ day: days[new Date(date).getDay()], completed, date });
}
const maxVal = Math.max(...weekData.map(d => d.completed), 1);
document.getElementById('weeklyChart').innerHTML = weekData.map(d => {
const height = Math.max(8, (d.completed / maxVal) * 140);
return `<div class="chart-bar" style="height:${height}px;background:linear-gradient(to top,var(--primary),var(--primary-light))"><div class="bar-value">${d.completed}</div><div class="bar-label">${d.day}</div></div>`;
}).join('');
const completed = tasks.filter(t => t.completed).length;
const total = tasks.length;
const rate = total > 0 ? Math.round((completed/total)*100) : 0;
const circumference = 2 * Math.PI * 50;
const offset = circumference - (rate / 100) * circumference;
document.getElementById('completionRing').innerHTML = `<svg width="120" height="120"><circle class="ring-bg" cx="60" cy="60" r="50"/><circle class="ring-fill" cx="60" cy="60" r="50" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/></svg><div class="ring-text"><div class="ring-value">${rate}%</div><div class="ring-label">${completed}/${total}</div></div>`;
}

// ============================================================
// RELAX MODE
// ============================================================
function startBreathingExercise() {
const circle = document.getElementById('relaxCircle');
const phaseEl = document.getElementById('breathPhase');
const ring = document.getElementById('breathRing');
const CIRCUMFERENCE = 628;
if (breathInterval) {
clearTimeout(breathInterval);
breathInterval = null;
ring.style.transition = 'none';
ring.style.strokeDashoffset = CIRCUMFERENCE;
phaseEl.innerHTML = '🌬️<br>Toca para<br>empezar';
circle.classList.remove('active');
return;
}
circle.classList.add('active');
const phases = [
{ name: 'Inhala...', duration: 4000, color: 'var(--success)' },
{ name: 'Mantén...', duration: 7000, color: 'var(--warning)' },
{ name: 'Exhala...', duration: 8000, color: 'var(--info)' }
];
let phaseIndex = 0;
function runPhase() {
const phase = phases[phaseIndex];
phaseEl.textContent = phase.name;
ring.style.stroke = phase.color;
ring.style.transition = 'none';
ring.style.strokeDashoffset = CIRCUMFERENCE;
requestAnimationFrame(() => {
ring.style.transition = `stroke-dashoffset ${phase.duration}ms linear`;
ring.style.strokeDashoffset = '0';
});
phaseIndex = (phaseIndex + 1) % phases.length;
breathInterval = setTimeout(runPhase, phase.duration);
}
runPhase();
}

// ============================================================
// SYNC
// ============================================================
function updateSyncInfo() {
const db = getDB();
const info = document.getElementById('syncTabsInfo');
info.innerHTML = `<p>📦 Datos: ${Object.keys(db).length} secciones</p><p>📋 Tareas: ${(db.tasks||[]).length} | 💳 Gastos: ${(db.expenses||[]).length}</p><p>💬 Chat: ${(db.globalChat||[]).length} | 🌌 Chats de rutina: ${Object.keys(db.dmMessages||{}).length}</p><p>🔄 Sync: ${syncChannel ? '✅ Activa' : '❌ No disponible'}</p>`;
}
function exportFullDB() {
const db = getDB();
const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rutinas-sv-backup-' + new Date().toISOString().split('T')[0] + '.json'; a.click();
showToast('📥 Backup exportado', 'success');
const habits = getHabits(); habits.dataExported = true; saveHabits(habits); checkAchievements();
}
function exportTasks() {
const tasks = getTasks();
const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rutinas-sv-tasks-' + new Date().toISOString().split('T')[0] + '.json'; a.click();
showToast('📥 Tareas exportadas', 'success');
}
function importData(event) {
const file = event.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = e => {
try {
const data = JSON.parse(e.target.result);
if (data.users && data.tasks) {
if (confirm('¿Reemplazar todos los datos?')) { saveDB(data); showApp(); showToast('📤 Importado', 'success'); }
} else { showToast('Formato no reconocido', 'error'); }
} catch(err) { showToast('Error al leer', 'error'); }
};
reader.readAsText(file);
}
function testSync() { syncBroadcast('test_sync'); showToast('🔄 Señal enviada', 'success'); }

// ============================================================
// THEMES
// ============================================================
const themes = [
{id:'bosque',name:'🌳 Bosque',color:'#2d6a4f'},{id:'oceano',name:'🌊 Océano',color:'#0077b6'},
{id:'desierto',name:'🏜️ Desierto',color:'#bc6c25'},{id:'aurora',name:'🌌 Aurora',color:'#7209b7'},
{id:'volcan',name:'🌋 Volcán',color:'#d00000'},{id:'galaxia',name:'🌠 Galaxia',color:'#3a0ca3'},
{id:'neblina',name:'🌫️ Neblina',color:'#6c757d'},{id:'lavanda',name:'💜 Lavanda',color:'#9b5de5'},
{id:'cafe',name:'☕ Café',color:'#6f4e37'},{id:'tropical',name:'🌴 Tropical',color:'#06d6a0'}
];
function initThemes() {
document.getElementById('themeGrid').innerHTML = themes.map(t => `<div class="theme-option" data-theme="${t.id}" onclick="applyTheme('${t.id}')"><div class="theme-preview" style="background:${t.color}"></div><div>${t.name}</div></div>`).join('');
}
function applyTheme(id) {
document.documentElement.setAttribute('data-theme', id);
document.querySelectorAll('.theme-option').forEach(el => el.classList.toggle('active', el.dataset.theme === id));
const db = getDB(); if (!db.settings) db.settings = {}; db.settings.theme = id; saveDB(db);
showToast('🎨 Tema aplicado', 'success');
}
function toggleDarkMode() {
const isDark = document.documentElement.getAttribute('data-darkmode') === 'true';
const next = !isDark;
document.documentElement.setAttribute('data-darkmode', next ? 'true' : 'false');
const btn = document.getElementById('darkModeCornerBtn');
if (btn) { btn.classList.toggle('active', next); btn.textContent = next ? '☀️' : '🌙'; }
const db = getDB(); if (!db.settings) db.settings = {}; db.settings.darkMode = next; saveDB(db);
showToast(next ? '🌙 Modo oscuro' : '☀️ Modo claro', 'success');
}

// ============================================================
// COLOR CUSTOMIZATION
// ============================================================
function applyCustomColors() {
const primary = document.getElementById('colorPrimary').value;
const primaryLight = document.getElementById('colorPrimaryLight').value;
const text = document.getElementById('colorText').value;
const bg = document.getElementById('colorBg').value;
const root = document.documentElement;
root.style.setProperty('--primary', primary);
root.style.setProperty('--primary-light', primaryLight);
root.style.setProperty('--text', text);
root.style.setProperty('--bg', bg);
const db = getDB();
if (!db.settings) db.settings = {};
db.settings.customColors = { primary, primaryLight, text, bg };
saveDB(db);
showToast('🎨 Colores aplicados', 'success');
}
function resetCustomColors() {
const root = document.documentElement;
root.style.removeProperty('--primary');
root.style.removeProperty('--primary-light');
root.style.removeProperty('--text');
root.style.removeProperty('--bg');
const db = getDB();
if (!db.settings) db.settings = {};
delete db.settings.customColors;
saveDB(db);
showToast('🔄 Restaurado', 'success');
}
function applyCustomColorsFromSettings(colors) {
if (!colors) return;
const root = document.documentElement;
if (colors.primary) root.style.setProperty('--primary', colors.primary);
if (colors.primaryLight) root.style.setProperty('--primary-light', colors.primaryLight);
if (colors.text) root.style.setProperty('--text', colors.text);
if (colors.bg) root.style.setProperty('--bg', colors.bg);
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function togglePushNotif() { const t = document.getElementById('togglePush'); t.classList.toggle('active'); const db = getDB(); if(!db.settings) db.settings={}; db.settings.pushNotif = t.classList.contains('active'); saveDB(db); }
function toggleSoundNotif() { const t = document.getElementById('toggleSound'); t.classList.toggle('active'); const db = getDB(); if(!db.settings) db.settings={}; db.settings.soundNotif = t.classList.contains('active'); saveDB(db); }
function toggleWalletAlert() { const t = document.getElementById('toggleWalletAlert'); t.classList.toggle('active'); const db = getDB(); if(!db.settings) db.settings={}; db.settings.walletAlert = t.classList.contains('active'); saveDB(db); }
function toggleAiSuggestions() { const t = document.getElementById('toggleAiSuggestions'); t.classList.toggle('active'); const db = getDB(); if(!db.settings) db.settings={}; db.settings.aiSuggestions = t.classList.contains('active'); saveDB(db); if(t.classList.contains('active')) renderDashboardAiSuggestions(); else document.getElementById('dashboardAiSuggestions').innerHTML = ''; }
function testSound() { playNotificationSound(); showToast('🔊 Sonido', 'success'); }
function playNotificationSound() {
try {
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
o1.type='sine'; o2.type='sine';
o1.frequency.setValueAtTime(587.33,ctx.currentTime); o1.frequency.setValueAtTime(783.99,ctx.currentTime+0.15);
g.gain.setValueAtTime(0.3,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.6);
o1.connect(g); o2.connect(g); g.connect(ctx.destination);
o1.start(ctx.currentTime); o2.start(ctx.currentTime+0.15); o1.stop(ctx.currentTime+0.6); o2.stop(ctx.currentTime+0.6);
} catch(e) {}
}
function renderNotifHistory() {
const container = document.getElementById('notifHistory');
if (notifHistory.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><h3>Sin notificaciones</h3></div>'; return; }
container.innerHTML = notifHistory.map(n => `<div style="padding:12px 0;border-bottom:1px solid #f0f0f0"><div style="font-weight:600">${n.title}</div><div style="font-size:0.85em;color:var(--text-light)">${n.message}</div></div>`).join('');
}

// ============================================================
// DASHBOARD AI SUGGESTIONS
// ============================================================
function renderDashboardAiSuggestions() {
const container = document.getElementById('dashboardAiSuggestions');
const db = getDB();
const settings = db.settings || {};
if (settings.aiSuggestions === false) { container.innerHTML = ''; return; }
const tasks = getTasks();
const pending = tasks.filter(t => !t.completed);
const hour = new Date().getHours();
let suggestions = [];
if (pending.length > 0 && !tasks.some(t => t.time)) {
suggestions.push({ icon: '🤖', title: 'IA sugiere auto-agendar', text: 'Tienes ' + pending.length + ' tareas sin hora.', action: 'navigateTo("tasks")' });
}
if (hour >= 6 && hour < 10) { suggestions.push({ icon: '🌅', title: 'Buen momento para trabajo profundo', text: 'Las mañanas son ideales para tareas de alta prioridad.' }); }
else if (hour >= 17 && hour < 19) { suggestions.push({ icon: '🏃', title: 'Momento ideal para ejercicio', text: 'La tarde-noche es perfecta para actividad física.' }); }
const streak = getStreak();
if (streak >= 3) { suggestions.push({ icon: '🔥', title: '¡Racha de ' + streak + ' días!', text: 'Excelente constancia.' }); }
container.innerHTML = suggestions.map(s => `
<div class="ai-suggestion-card animate-fade">
<div class="ai-header"><div class="ai-icon">${s.icon}</div><div class="ai-title">${s.title}</div></div>
<div class="ai-text">${s.text}</div>
${s.action ? `<div class="ai-action"><button class="btn btn-primary btn-sm" onclick="${s.action}" style="width:auto">→ Aplicar</button></div>` : ''}
</div>
`).join('');
}

// ============================================================
// PROFILE
// ============================================================
async function updateProfile() {
const newUsername = document.getElementById('editUsername').value.trim();
const newEmail = document.getElementById('editEmail').value.trim();
const newPassword = document.getElementById('editPassword').value;
if (!newUsername || !newEmail) { showToast('Nombre y correo obligatorios', 'error'); return; }
const db = getDB();
const user = db.users.find(u => u.id === currentUser.id);
if (user) {
if (db.users.find(u => u.id !== currentUser.id && (u.username === newUsername || u.email === newEmail))) { showToast('Ya existe', 'error'); return; }
user.username = newUsername; user.email = newEmail;
if (newPassword && newPassword.length >= 4) { const salt = genSalt(); user.passwordHash = await hashPassword(newPassword, salt); user.passwordSalt = salt; delete user.password; }
currentUser = user; saveDB(db); localStorage.setItem('rutinasSvSession', JSON.stringify(user));
document.getElementById('headerAvatar').textContent = user.username.charAt(0).toUpperCase();
document.getElementById('profileAvatar').textContent = user.username.charAt(0).toUpperCase();
document.getElementById('profileName').textContent = user.username;
document.getElementById('profileEmail').textContent = user.email;
document.getElementById('editPassword').value = '';
renderProfileShowcase();
showToast('✅ Actualizado', 'success');
}
}

// ============================================================
// ADMIN
// ============================================================
function renderAdminPanel() {
const db = getDB();
const allTasks = db.tasks || [];
const users = db.users || [];
const completedTasks = allTasks.filter(t => t.completed).length;
const activeRoutineChats = Object.keys(db.dmMessages || {}).length;
const statesCount = (db.states || []).length;
document.getElementById('adminStats').innerHTML = `
<div class="admin-stat"><div class="value">${users.length}</div><div class="label">Usuarios</div></div>
<div class="admin-stat"><div class="value">${allTasks.length}</div><div class="label">Tareas</div></div>
<div class="admin-stat"><div class="value">${completedTasks}</div><div class="label">Completadas</div></div>
<div class="admin-stat"><div class="value">${activeRoutineChats}</div><div class="label">Chats de Rutina</div></div>
<div class="admin-stat"><div class="value">${statesCount}</div><div class="label">Estados</div></div>`;
document.getElementById('userTableBody').innerHTML = users.map(u => {
const ut = allTasks.filter(t => t.userId === u.id);
const rn = { boss: '👑 CEO', admin: '🛡️ Admin', user: '👤 Usuario' };
const created = new Date(u.createdAt);
return `<tr><td><strong>${u.username}</strong></td><td>${u.email}</td><td><span class="role-badge ${u.role}">${rn[u.role]||rn.user}</span></td><td>${created.toLocaleDateString('es-ES')}</td><td>${ut.length}</td><td>${u.role!=='boss'?'<button class="btn btn-danger btn-sm" onclick="deleteUser(\''+u.id+'\')" style="padding:6px 12px;font-size:0.8em">🗑️</button>':'<span style="color:#999;font-size:0.85em">Protegido</span>'}</td></tr>`;
}).join('');
}
function deleteUser(id) { if (!confirm('¿Eliminar usuario?')) return; const db = getDB(); db.users = db.users.filter(u => u.id !== id); db.tasks = (db.tasks||[]).filter(t => t.userId !== id); saveDB(db); renderAdminPanel(); showToast('🗑️ Eliminado', 'warning'); }
function importDB(event) { const file = event.target.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = e => { try { const data = JSON.parse(e.target.result); if(data.users && data.tasks && confirm('¿Reemplazar?')) { saveDB(data); showApp(); showToast('✅ Importado','success'); } } catch(err) { showToast('Error','error'); } }; reader.readAsText(file); }
function clearAllData() { if(!confirm('⚠️ ¿Eliminar TODO?')) return; if(!confirm('⚠️ ÚLTIMA ADVERTENCIA')) return; localStorage.removeItem('rutinasSvDB_v2'); localStorage.removeItem('rutinasSvSession'); showToast('🗑️ Eliminado','warning'); setTimeout(()=>location.reload(),1500); }

// ============================================================
// DASHBOARD
// ============================================================
function updateDashboard() {
renderGardenPreview();
renderSurvivalBanner();
const tasks = getTasks();
const total = tasks.length;
const completed = tasks.filter(t => t.completed).length;
document.getElementById('statTotal').textContent = total;
document.getElementById('statCompleted').textContent = completed;
document.getElementById('statPending').textContent = total - completed;
document.getElementById('statAiTokens').textContent = getAiTokens() + '/' + AI_TOKEN_MAX;
const hour = new Date().getHours();
let greeting = '¡Buenas noches! 🌙';
if (hour >= 5 && hour < 12) greeting = '¡Buenos días! ☀️';
else if (hour >= 12 && hour < 18) greeting = '¡Buenas tardes! ☀️';
else if (hour >= 18 && hour < 21) greeting = '¡Buenas tardes! 🌅';
document.getElementById('greetingText').textContent = greeting + ' ' + currentUser.username;
document.getElementById('greetingDate').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
document.getElementById('streakCount').textContent = getStreak();
const upcoming = tasks.filter(t => !t.completed).slice(0, 5);
const container = document.getElementById('dashboardTasks');
if (upcoming.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>Sin tareas pendientes</h3></div>'; return; }
const catIcons = { trabajo:'💼', personal:'🏠', salud:'❤️', estudio:'📚', hogar:'🏡', otro:'📌' };
container.innerHTML = upcoming.map(task => {
const dateObj = new Date(task.date + 'T00:00:00');
return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0"><span style="font-size:1.2em">${catIcons[task.category]}</span><div style="flex:1"><div style="font-weight:600;font-size:0.92em">${task.title}</div><div style="font-size:0.8em;color:var(--text-light)">📅 ${dateObj.toLocaleDateString('es-ES',{day:'numeric',month:'short'})} ${task.time?'• 🕐 '+task.time:''}</div></div></div>`;
}).join('');
}

// ============================================================
// GARDEN
// ============================================================
const GARDEN_CATS = {
trabajo: { icon: '💼', label: 'Trabajo', color: '#457b9d' },
personal: { icon: '🏠', label: 'Personal', color: '#2a9d8f' },
salud: { icon: '❤️', label: 'Salud', color: '#e76f51' },
estudio: { icon: '📚', label: 'Estudio', color: '#e9c46a' },
hogar: { icon: '🏡', label: 'Hogar', color: '#7209b7' },
otro: { icon: '📌', label: 'Otro', color: '#6c757d' }
};
function gardenCategoryStats() {
const tasks = getTasks();
const today = new Date();
const stats = {};
Object.keys(GARDEN_CATS).forEach(cat => {
const catTasks = tasks.filter(t => t.category === cat);
const completed = catTasks.filter(t => t.completed);
let lastDone = null;
completed.forEach(t => { if (t.completedAt) { const d = new Date(t.completedAt); if (!lastDone || d > lastDone) lastDone = d; } });
const daysSince = lastDone ? Math.floor((today - lastDone) / 86400000) : null;
const wilted = daysSince === null || daysSince > 3;
stats[cat] = { total: catTasks.length, completed: completed.length, daysSince, wilted };
});
return stats;
}
function gardenBloomingCount() {
const stats = gardenCategoryStats();
return Object.values(stats).filter(s => !s.wilted && s.completed >= 3).length;
}
function gardenPlantSVG(x, cat, info, seed) {
const meta = GARDEN_CATS[cat];
const h = Math.min(64, 16 + info.completed * 3.5);
const color = info.wilted ? '#c9c2b8' : meta.color;
const flowers = (!info.wilted && info.completed >= 5) ? Math.min(4, Math.floor(info.completed / 5)) : 0;
let f = '';
for (let i = 0; i < flowers; i++) { const fx = x + (i % 2 === 0 ? -6 : 6); const fy = 98 - h - 6 - i * 9; f += `<circle cx="${fx}" cy="${fy}" r="3.2" fill="${meta.color}" opacity="0.9"/>`; }
return `<g class="garden-plant" style="animation-delay:${seed * 0.25}s">
<path d="M${x} 98 C${x - 2} ${98 - h * 0.5},${x + 7} ${98 - h * 0.7},${x} ${98 - h}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M${x} 98 C${x + 2} ${98 - h * 0.4},${x - 7} ${98 - h * 0.6},${x} ${98 - h * 0.85}" stroke="${color}" stroke-width="2.3" fill="none" stroke-linecap="round" opacity="0.75"/>
${f}
<text x="${x}" y="110" text-anchor="middle" font-size="12">${meta.icon}</text>
</g>`;
}
function buildGardenSVG(width) {
const stats = gardenCategoryStats();
const cats = Object.keys(GARDEN_CATS);
const n = cats.length;
let plants = '';
cats.forEach((cat, i) => { const px = 28 + (width - 56) * (i / (n - 1)); plants += gardenPlantSVG(px, cat, stats[cat], i); });
return `<svg viewBox="0 0 ${width} 118" width="100%" height="140" preserveAspectRatio="xMidYMax meet">
<rect x="0" y="98" width="${width}" height="16" fill="var(--glass-border)" opacity="0.5"/>
${plants}
</svg>`;
}
function renderGardenPreview() {
const el = document.getElementById('gardenPreviewSvg');
if (!el) return;
el.innerHTML = buildGardenSVG(380);
}
function renderGarden() {
const stats = gardenCategoryStats();
document.getElementById('gardenFullSvg').innerHTML = buildGardenSVG(480);
const blooming = gardenBloomingCount();
document.getElementById('gardenSubtitle').textContent = `${blooming} de ${Object.keys(GARDEN_CATS).length} categorías floreciendo`;
document.getElementById('gardenLegend').innerHTML = Object.entries(GARDEN_CATS).map(([cat, meta]) => {
const s = stats[cat];
const status = s.wilted ? 'marchita 🥀' : (s.completed >= 5 ? 'floreciendo 🌸' : 'creciendo 🌱');
return `<div class="gl-item"><span class="gl-dot" style="background:${s.wilted ? '#c9c2b8' : meta.color}"></span>${meta.icon} ${meta.label} · ${s.completed} completadas · ${status}</div>`;
}).join('');
}
function renderSurvivalBanner() {
const el = document.getElementById('survivalBanner');
if (!el) return;
const habits = getHabits();
const streakData = habits.streak || { count: 0, lastDate: null };
const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const broken = streakData.lastDate && streakData.lastDate !== today && streakData.lastDate !== yesterday;
el.innerHTML = broken
? `<div class="garden-survival"><span class="gs-icon">🥀</span><div><strong>Modo Supervivencia</strong><br><span style="font-size:0.9em;opacity:0.95">Tu racha se marchitó.</span></div><button class="gs-btn" onclick="navigateTo('tasks')">Reto rápido</button></div>`
: '';
}

// ============================================================
// UTILS
// ============================================================
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function showToast(message, type = 'success') {
const container = document.getElementById('toastContainer');
const toast = document.createElement('div');
toast.className = 'toast ' + type;
const icons = { success: '✅', error: '❌', warning: '⚠️', xp: '⭐', achievement: '🏆' };
toast.innerHTML = '<span class="toast-icon">' + (icons[type]||'ℹ️') + '</span><span class="toast-message">' + message + '</span><div class="toast-progress"><div class="toast-progress-fill"></div></div>';
container.appendChild(toast);
setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, type === 'xp' ? 5000 : 4000);
}

// ============================================================
// WEATHER + RADAR
// ============================================================
const WMO_CODES = { 0:'☀️ Despejado',1:'🌤️ Mayormente despejado',2:'⛅ Parcialmente nublado',3:'☁️ Nublado',45:'🌫️ Neblina',48:'🌫️ Neblina con escarcha',51:'🌦️ Llovizna ligera',53:'🌦️ Llovizna',55:'🌧️ Llovizna densa',61:'🌧️ Lluvia ligera',63:'🌧️ Lluvia',65:'🌧️ Lluvia intensa',71:'❄️ Nieve ligera',73:'❄️ Nieve',75:'❄️ Nevada intensa',80:'🌦️ Chubascos',81:'🌦️ Chubascos',82:'⛈️ Chubascos fuertes',95:'⛈️ Tormenta',96:'⛈️ Tormenta con granizo',99:'⛈️ Tormenta fuerte' };
const WMO_ICONS = { 0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'❄️',73:'❄️',75:'❄️',80:'🌦️',81:'🌦️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️' };
let weatherCache = null;
let weatherCacheTime = 0;
let lastWeatherCoords = { lat: 13.6929, lon: -89.2182 }; // Default: El Salvador
const WEATHER_TTL = 10 * 60 * 1000;

function initWeatherBackground() {
if (navigator.geolocation) {
navigator.geolocation.getCurrentPosition(pos => {
lastWeatherCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
fetchWeatherData(pos.coords.latitude, pos.coords.longitude).then(data => {
weatherCache = data;
weatherCacheTime = Date.now();
updateWeatherMini(data);
}).catch(() => {});
}, () => {
fetchWeatherData(13.6929, -89.2182).then(data => {
weatherCache = data;
weatherCacheTime = Date.now();
updateWeatherMini(data);
}).catch(() => {});
});
}
}
async function fetchWeatherData(lat, lon) {
const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure,uv_index&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=1`;
const res = await fetch(url);
if (!res.ok) throw new Error('Weather API error');
return await res.json();
}
function updateWeatherMini(data) {
const widget = document.getElementById('weatherMiniWidget');
const iconEl = document.getElementById('weatherMiniIcon');
const tempEl = document.getElementById('weatherMiniTemp');
if (!widget || !data || !data.current) return;
const temp = Math.round(data.current.temperature_2m);
const code = data.current.weather_code;
widget.style.display = 'flex';
iconEl.textContent = WMO_ICONS[code] || '🌤️';
tempEl.textContent = temp + '°C';
}
function loadWeather(forceRefresh) {
const now = Date.now();
if (!forceRefresh && weatherCache && (now - weatherCacheTime) < WEATHER_TTL) {
renderWeatherPage(weatherCache);
loadRadar();
return;
}
const mainCard = document.getElementById('weatherMainCard');
const detailsEl = document.getElementById('weatherDetails');
mainCard.innerHTML = '<div style="font-size:2.5em"><span class="spinning">⟳</span></div><p style="margin-top:10px">Obteniendo clima...</p>';
mainCard.className = 'weather-loading';
if (detailsEl) detailsEl.style.display = 'none';

// Track weather checks for achievement
const habits = getHabits();
habits.weatherChecks = (habits.weatherChecks || 0) + 1;
saveHabits(habits);
checkAchievements();

if (navigator.geolocation) {
navigator.geolocation.getCurrentPosition(pos => {
lastWeatherCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
fetchWeatherData(pos.coords.latitude, pos.coords.longitude).then(data => {
weatherCache = data;
weatherCacheTime = Date.now();
updateWeatherMini(data);
renderWeatherPage(data);
loadRadar();
}).catch(() => showWeatherError());
}, () => {
fetchWeatherData(13.6929, -89.2182).then(data => {
weatherCache = data;
weatherCacheTime = Date.now();
updateWeatherMini(data);
renderWeatherPage(data);
loadRadar();
}).catch(() => showWeatherError());
}, { timeout: 8000 });
} else {
showWeatherError('Tu navegador no permite geolocalización.');
}
}
function showWeatherError(msg) {
const mainCard = document.getElementById('weatherMainCard');
mainCard.className = '';
mainCard.innerHTML = '<div class="weather-error">⚠️ ' + (msg || 'No se pudo obtener el clima.') + '</div>';
}
function renderWeatherPage(data) {
const mainCard = document.getElementById('weatherMainCard');
const detailsEl = document.getElementById('weatherDetails');
const cur = data.current;
if (!cur) { showWeatherError(); return; }
const temp = Math.round(cur.temperature_2m);
const feelsLike = Math.round(cur.apparent_temperature);
const humidity = cur.relative_humidity_2m;
const wind = Math.round(cur.wind_speed_10m);
const code = cur.weather_code;
const desc = WMO_CODES[code] || '🌤️ Variable';
const icon = WMO_ICONS[code] || '🌡️';
const pressure = Math.round(cur.surface_pressure);
const uv = cur.uv_index !== undefined ? Math.round(cur.uv_index) : '--';
const loc = data.timezone ? data.timezone.split('/').pop().replace('_',' ') : 'Tu ubicación';

mainCard.className = 'weather-page-card animate-fade';
mainCard.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;position:relative;z-index:1">
<div>
<div style="display:flex;align-items:center;gap:14px">
<div class="weather-main-temp">${temp}°C</div>
<div class="weather-main-icon">${icon}</div>
</div>
<div class="weather-main-desc">${desc.replace(/^[^\s]+ /,'')}</div>
<div class="weather-main-loc">📍 ${loc}</div>
</div>
<div style="text-align:right">
<button class="weather-refresh-btn" onclick="loadWeather(true)">🔄 Actualizar</button>
<div style="margin-top:10px;opacity:0.8;font-size:0.85em">Sensación: ${feelsLike}°C</div>
</div>
</div>`;

document.getElementById('weatherDetailsGrid').innerHTML = `
<div class="weather-detail-card"><div class="wd-icon">💧</div><div class="wd-val">${humidity}%</div><div class="wd-label">Humedad</div></div>
<div class="weather-detail-card"><div class="wd-icon">💨</div><div class="wd-val">${wind} km/h</div><div class="wd-label">Viento</div></div>
<div class="weather-detail-card"><div class="wd-icon">🌡️</div><div class="wd-val">${feelsLike}°C</div><div class="wd-label">Sensación</div></div>
<div class="weather-detail-card"><div class="wd-icon">📊</div><div class="wd-val">${pressure} hPa</div><div class="wd-label">Presión</div></div>
<div class="weather-detail-card"><div class="wd-icon">☀️</div><div class="wd-val">${uv}</div><div class="wd-label">Índice UV</div></div>`;

const now = new Date();
const hourly = data.hourly;
let hourlyHtml = '';
if (hourly && hourly.time) {
let count = 0;
for (let i = 0; i < hourly.time.length && count < 12; i++) {
const t = new Date(hourly.time[i]);
if (t < now) continue;
const hTemp = Math.round(hourly.temperature_2m[i]);
const hCode = hourly.weather_code[i];
const hIcon = WMO_ICONS[hCode] || '🌤️';
const hHour = t.getHours().toString().padStart(2,'0') + ':00';
hourlyHtml += `<div class="weather-hour-item"><div class="wh-time">${hHour}</div><div class="wh-icon">${hIcon}</div><div class="wh-temp">${hTemp}°C</div></div>`;
count++;
}
}
document.getElementById('weatherHourly').innerHTML = hourlyHtml || '<p style="color:var(--text-light);font-size:0.9em;padding:10px">Sin datos horarios.</p>';
const updEl = document.getElementById('weatherUpdatedAt');
if (updEl) updEl.textContent = now.toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
detailsEl.style.display = 'block';
}

// ====== RADAR DE LLUVIA ======
function loadRadar() {
const iframe = document.getElementById('radarIframe');
const locEl = document.getElementById('radarLocation');
if (!iframe) return;

const lat = lastWeatherCoords.lat;
const lon = lastWeatherCoords.lon;

// Usamos RainViewer (gratuito, sin API key) para el radar de precipitaciones
// URL de embed del radar con las coordenadas del usuario
const radarUrl = `https://www.rainviewer.com/map.html?loc=${lat},${lon},8&oFa=0&oC=0&oU=0&oCS=1&oF=0&oAP=true&lm=1&th_s=1&thu=0&c=1&o=83&sm=1&sn=10&zm=1`;

iframe.src = radarUrl;

if (locEl) {
locEl.textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}
}

function refreshRadar() {
loadRadar();
showToast('🔄 Radar actualizado', 'success');
}

// ============================================================
// AMBIENT SOUNDS
// ============================================================
let ambCtx = null, ambNodes = [], ambActive = '';
function stopAllRelaxSounds() { ambNodes.forEach(n => { try { n.stop && n.stop(); } catch(e) {} }); ambNodes = []; if (ambCtx) { try { ambCtx.close(); } catch(e) {} ambCtx = null; } ambActive = ''; document.querySelectorAll('.relax-sound-btn').forEach(b => b.classList.remove('active')); }
function toggleRelaxSound(type, btn) {
if (ambActive === type) { stopAllRelaxSounds(); return; }
stopAllRelaxSounds();
ambActive = type;
btn.classList.add('active');
const habits = getHabits(); habits.relaxUsed = true; saveHabits(habits); checkAchievements();
try {
ambCtx = new (window.AudioContext || window.webkitAudioContext)();
const master = ambCtx.createGain();
master.gain.value = 0.3;
master.connect(ambCtx.destination);
function mkNoise(brown) {
const buf = ambCtx.createBuffer(1, ambCtx.sampleRate * 3, ambCtx.sampleRate);
const d = buf.getChannelData(0); let last = 0;
for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; d[i] = brown ? (last = last * 0.99 + w * 0.01) * 15 : w; }
const src = ambCtx.createBufferSource(); src.buffer = buf; src.loop = true;
return src;
}
if (type === 'rain') {
const n = mkNoise(true), g = ambCtx.createGain(), f = ambCtx.createBiquadFilter();
f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.5; g.gain.value = 2.5;
n.connect(f); f.connect(g); g.connect(master); n.start(); ambNodes.push(n);
} else if (type === 'waves') {
const n = mkNoise(true), lfo = ambCtx.createOscillator(), lg = ambCtx.createGain();
lfo.frequency.value = 0.15; lg.gain.value = 0.9; lfo.connect(lg);
const g = ambCtx.createGain(); g.gain.value = 1.5; lg.connect(g.gain); n.connect(g); g.connect(master);
lfo.start(); n.start(); ambNodes.push(n, lfo);
} else if (type === 'forest') {
const n = mkNoise(false), g = ambCtx.createGain(), f = ambCtx.createBiquadFilter();
f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0.07;
n.connect(f); f.connect(g); g.connect(master); n.start(); ambNodes.push(n);
}
} catch(e) {}
}

// ============================================================
// MOTOR ORBITAL REUTILIZABLE (usado por la Línea Orbital de tareas
// y por Rutinas en Órbita — el chat orbita igual que las tareas)
// ============================================================
function createOrbitalEngine(cfg) {
var angle = 0, autoRot = true, timer = null;
var expandedId = null, activeId = null, filterType = 'all';
var items = [];
var RADIUS = cfg.radius || 190, SPEED = cfg.speed || 0.25;
function visible() {
if (filterType==='all') return items;
if (cfg.filterFn) return items.filter(function(i){ return cfg.filterFn(i, filterType); });
return items;
}
function calcPos(idx, total, ang) { var a = ((idx/total)*360 + ang) % 360; var rad = a * Math.PI / 180; return { x: RADIUS*Math.cos(rad), y: RADIUS*Math.sin(rad), zIdx: Math.round(100+50*Math.cos(rad)), opacity: Math.max(0.3, Math.min(1, 0.3+0.7*((1+Math.sin(rad))/2))), rad: rad }; }
function render() {
var scene = document.getElementById(cfg.sceneId);
if (!scene) return;
scene.querySelectorAll('.orbital-node').forEach(function(n){ n.remove(); });
var vis = visible(), total = vis.length;
var emptyEl = cfg.emptyId ? document.getElementById(cfg.emptyId) : null;
if (emptyEl) emptyEl.style.display = total === 0 ? 'flex' : 'none';
vis.forEach(function(item, idx) {
var pos = calcPos(idx, total, angle);
var isExp = expandedId === item.id;
var nodeBg = cfg.nodeBg ? cfg.nodeBg(item) : 'rgba(0,0,0,0.82)';
var node = document.createElement('div');
node.className = 'orbital-node';
node.dataset.id = item.id;
node.style.cssText = 'left:calc(50% + '+pos.x+'px);top:calc(50% + '+pos.y+'px);z-index:'+(isExp?200:pos.zIdx)+';opacity:'+(isExp?1:pos.opacity);
node.innerHTML = '<div class="orbital-node-btn'+(isExp?' expanded':'')+'" style="background:'+nodeBg+'">'+(item.icon)+'</div><div class="orbital-node-label'+(isExp?' expanded':'')+'">'+item.title+'</div>';
node.addEventListener('click', function(e){ e.stopPropagation(); toggleNode(item.id); });
if (isExp) {
var isBottom = pos.y > 0;
var xOff = pos.x > 80 ? '-200px' : pos.x < -80 ? '10px' : '-100px';
var yOff = isBottom ? 'bottom:52px' : 'top:52px';
var card = document.createElement('div');
card.className = 'orbital-card';
card.style.cssText = 'left:'+xOff+';'+yOff;
card.innerHTML = cfg.cardHtml(item);
card.addEventListener('click', function(e){ e.stopPropagation(); });
node.appendChild(card);
}
scene.appendChild(node);
});
}
function toggleNode(id) { if (expandedId === id) { expandedId = null; activeId = null; autoRot = true; startTimer(); } else { expandedId = id; activeId = id; autoRot = false; stopTimer(); } render(); }
function startTimer() { stopTimer(); if (!autoRot) return; timer = setInterval(function(){ angle = (angle+SPEED)%360; render(); }, 50); }
function stopTimer() { if (timer){ clearInterval(timer); timer=null; } }
function init() { items = cfg.buildItems(); angle = 0; expandedId = null; activeId = null; autoRot = true; render(); startTimer(); }
return {
init: init, destroy: stopTimer, goTo: function(id){ toggleNode(id); },
toggle: function(){ autoRot = !autoRot; var btn = document.getElementById(cfg.autoBtnId); if (btn){ btn.textContent = autoRot?'⟳ Auto':'⏸ Pausa'; btn.classList.toggle('active',autoRot); } autoRot ? startTimer() : stopTimer(); },
reset: function(){ angle=0; expandedId=null; activeId=null; render(); },
refresh: function(){ items=cfg.buildItems(); render(); },
setFilter: function(f){ filterType=f; expandedId=null; activeId=null; render(); }
};
}

// ---- instancia: Línea de Tiempo Orbital (tareas) ----
var ORBITAL_CAT_COLORS = { trabajo:'#4361ee', salud:'#2a9d8f', personal:'#7c3aed', rutina:'#e9c46a', urgente:'#e76f51' };
var ORBITAL_CAT_ICONS  = { trabajo:'💼', salud:'❤️', personal:'💜', rutina:'🔄', urgente:'🚨' };
var OrbitalTimeline = createOrbitalEngine({
sceneId: 'orbitalScene', autoBtnId: 'orbitAutoBtn', radius: 190, speed: 0.25,
buildItems: function() {
var db = getDB();
var uid = currentUser ? currentUser.id : null;
var tasks = (db.tasks||[]).filter(function(t){ return t.userId===uid; });
var out = [];
tasks.slice(-12).forEach(function(t) {
var energy = t.priority==='alta' ? 90 : t.priority==='media' ? 60 : 35;
out.push({ id: t.id, title: t.title.length>18 ? t.title.slice(0,18)+'…' : t.title, fullTitle: t.title, date: t.date || '', content: (t.desc||'Tarea')+' · '+t.priority, category: t.category||'personal', icon: ORBITAL_CAT_ICONS[t.category]||'📌', status: t.completed ? 'completed' : 'pending', energy: energy, color: ORBITAL_CAT_COLORS[t.category]||'#6c757d' });
});
if (out.length === 0) { out.push({ id:'demo1', title:'Agrega tareas', fullTitle:'Agrega tareas para verlas aquí', date:'Hoy', content:'Crea tareas en "Mis Tareas"', category:'personal', icon:'📝', status:'pending', energy:50, color:'#7c3aed' }); }
return out;
},
filterFn: function(i, f) { if (f==='completed') return i.status==='completed'; if (f==='pending') return i.status==='pending'; return i.category===f; },
nodeBg: function(item) { return item.status==='completed' ? item.color : 'rgba(0,0,0,0.82)'; },
cardHtml: function(item) {
var statLabel = {completed:'✓ Completada',pending:'⏳ Pendiente'}[item.status]||item.status;
var statCls = {completed:'badge-completed',pending:'badge-pending'}[item.status]||'badge-pending';
return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="orbital-card-badge '+statCls+'">'+statLabel+'</span><span class="orbital-card-date">'+item.date+'</span></div><div class="orbital-card-title">'+item.fullTitle+'</div><div class="orbital-card-content">'+item.content+'</div><div class="orbital-energy-bar"><div class="orbital-energy-label"><span>⚡ Energía</span><span>'+item.energy+'%</span></div><div class="orbital-energy-track"><div class="orbital-energy-fill" style="width:'+item.energy+'%"></div></div></div>';
}
});
function toggleOrbitalAuto() { OrbitalTimeline.toggle(); }
function resetOrbital() { OrbitalTimeline.reset(); }
function refreshOrbitalData() { OrbitalTimeline.refresh(); }
function handleOrbitalBgClick(e) { if (e.target.closest && (e.target.closest('.orbital-card') || e.target.closest('.orbital-node-btn'))) return; OrbitalTimeline.reset(); }
function setOrbitalFilter(f, btn) { document.querySelectorAll('.orbital-filter').forEach(function(b){ b.classList.remove('active'); }); btn.classList.add('active'); OrbitalTimeline.setFilter(f); }

// ---- instancia: Rutinas en Órbita (chats anclados a rutinas) ----
var RoutineChatOrbital = createOrbitalEngine({
sceneId: 'rcOrbitalScene', autoBtnId: 'rcOrbitAutoBtn', emptyId: 'rcOrbitalEmpty', radius: 150, speed: 0.18,
buildItems: function() {
var db = getDB();
var convs = getActiveRoutineConversations();
return convs.map(function(c) {
var peer = db.users.find(function(u){ return u.id === c.peerId; });
var lvl = computeEnergyLevel(c.peerId);
var energyPct = lvl==='alta'?90:lvl==='media'?55:25;
var title = (c.taskTitle||'Rutina');
return { id: c.convId, title: title.length>16 ? title.slice(0,16)+'…' : title, fullTitle: title, date: getTimeAgo(c.lastMessageAt), content: 'con ' + (peer?peer.username:'usuario') + (c.unread?(' · '+c.unread+' sin leer'):''), icon: c.taskIcon||'📌', status: c.unread>0?'unread':'active', energy: energyPct, energyLevel: lvl, color: ENERGY_META[lvl].color, peerId: c.peerId, convId: c.convId };
});
},
nodeBg: function(item) { return item.status==='unread' ? 'linear-gradient(135deg,var(--primary),var(--primary-light))' : 'rgba(0,0,0,0.82)'; },
cardHtml: function(item) {
return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+energyPillHtml(item.energyLevel)+'<span class="orbital-card-date">'+item.date+'</span></div><div class="orbital-card-title">'+item.fullTitle+'</div><div class="orbital-card-content">'+item.content+'</div><button class="orbital-btn active" style="margin-top:10px;width:100%;text-align:center" onclick="openRoutineCapsule(\'' + item.convId + '\')">💬 Abrir chat</button>';
}
});
(function(){ var _orig = navigateTo; navigateTo = function(page) {
if (page !== 'orbital') OrbitalTimeline.destroy();
if (page !== 'privatechats') RoutineChatOrbital.destroy();
_orig(page);
if (page === 'orbital') { setTimeout(function(){ OrbitalTimeline.init(); }, 100); }
if (page === 'privatechats') { setTimeout(function(){ RoutineChatOrbital.init(); }, 100); }
}; })();
