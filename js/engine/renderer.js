let canvas, ctx;
let camera = { x: 0, y: 0, zoom: 0.8 };
let renderState = {
    units: new Map(), 
    projectiles: [] 
};

function initRenderer() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Initialize input listeners (moved from main)
    canvas.addEventListener('mousedown', onDown); 
    canvas.addEventListener('mousemove', onMove); 
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, {passive: false}); 
    canvas.addEventListener('touchmove', onMove, {passive: false}); 
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        camera.zoom = Math.max(0.2, Math.min(camera.zoom * (1 - e.deltaY * 0.001), 2.5));
    });
    window.addEventListener('contextmenu', e => e.preventDefault());
    
    // Center camera if possible
    if (typeof localPlayerId !== 'undefined') {
        const me = simState.players.find(p => p.id === localPlayerId);
        if (me) { camera.x = me.x; camera.y = me.y; }
    }
}

function resizeCanvas() { 
    if(canvas) {
        canvas.width = window.innerWidth; 
        canvas.height = window.innerHeight; 
    }
}

function renderGame(dt) {
    if (!dt || dt > 0.5) dt = 0.016;
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    ctx.strokeStyle = '#333'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, GAME_DATA.mapRadius, 0, Math.PI * 2); ctx.stroke();

    if (!simState || !simState.players) { ctx.restore(); return; }

    simState.players.forEach(p => {
        if (p.hp <= 0) { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(p.x, p.y, GAME_DATA.baseRadius, 0, Math.PI*2); ctx.fill(); return; }
        
        const me = simState.players.find(me => me.id === localPlayerId);
        
        // Player Marker (You)
        if (p.id === localPlayerId) {
             ctx.save();
             ctx.fillStyle = '#FFFF00';
             ctx.beginPath();
             ctx.moveTo(p.x, p.y - GAME_DATA.baseRadius - 60);
             ctx.lineTo(p.x - 10, p.y - GAME_DATA.baseRadius - 80);
             ctx.lineTo(p.x + 10, p.y - GAME_DATA.baseRadius - 80);
             ctx.closePath();
             ctx.fill();
             
             // Pulse ring
             const pulse = (Date.now() % 2000) / 2000; 
             ctx.strokeStyle = `rgba(255, 255, 0, ${1 - pulse})`;
             ctx.lineWidth = 2;
             ctx.beginPath();
             ctx.arc(p.x, p.y, GAME_DATA.baseRadius + 20 + (pulse * 20), 0, Math.PI*2);
             ctx.stroke();
             ctx.restore();
        }

        if (me && me.targetId === p.id) {
            ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, GAME_DATA.baseRadius + 10, 0, Math.PI*2); ctx.stroke();
        }
        if (activeSettings.mode === 'TEAMS') {
             ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, GAME_DATA.baseRadius + 4, 0, Math.PI*2); ctx.stroke();
        }

        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, GAME_DATA.baseRadius, 0, Math.PI*2); ctx.fill();
        
        if(p.turrets.length > 0) {
            const tur = p.turrets[0]; const tData = getTurretData(tur.typeId);
            ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, Math.PI*2); ctx.fill(); 
            ctx.fillStyle = '#fff'; ctx.font = '36px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tData.icon, p.x, p.y);
        }

        drawBar(p.x, p.y - GAME_DATA.baseRadius - 15, 120, 12, p.hp, p.maxHp, '#0f0');
        ctx.fillStyle = '#fff'; ctx.font = '22px Arial'; ctx.fillText(p.name, p.x, p.y - GAME_DATA.baseRadius - 40);
    });

    const unitsToDraw = isHost ? simState.units : Array.from(renderState.units.values());
    unitsToDraw.forEach(u => {
        if (!isHost) {
            // Adaptive interpolation factor based on sync rate
            let rate = (typeof Network !== 'undefined' && Network.syncRate) ? Network.syncRate : 0.8;
            // Interpolate towards target. 
            // If rate is small (0.05s), we want to move fast.
            // If rate is large (0.8s), we want to move slow.
            // Let's use a fixed lerp factor that is adjusted by dt/rate.
            // But simple exponential decay is usually smoothest:
            // t = 1 - exp(-decay * dt).
            // We want to cover most of the distance in 'rate' time.
            // Let's just tune the previous "stiff" factor.
            // 0.001 was too stiff (0.89 remaining after 1 frame? No, 1 - 0.001^dt is actually very small if base is 0.001... wait)
            // Math.pow(0.001, dt). If dt=0.016. 0.001^0.016 = 0.895.
            // t = 1 - 0.895 = 0.105. (10% per frame).
            // 10% per frame at 60fps covers 99% of distance in ~0.7 seconds.
            // This matches the 0.8s update rate perfectly!
            // So for 0.05s update rate, we want to cover distance in 0.05s? 
            // No, that would be jittery if updates are slightly late.
            // We want it to look smooth.
            // Let's just use a slightly faster factor for offline.
            const base = (rate < 0.1) ? 0.000001 : 0.001; 
            // 0.000001 ^ 0.016 = 0.80. t = 0.2 (20% per frame). Faster convergence.
            const t = 1.0 - Math.pow(base, dt); 
            u.x += (u.targetX - u.x) * t; u.y += (u.targetY - u.y) * t;
            if (dist(u.x, u.y, u.targetX, u.targetY) > 60) { u.x = u.targetX; u.y = u.targetY; }
        }
        const p = simState.players.find(pl => pl.id === u.ownerId);
        const color = p ? p.color : '#fff';
        const scale = u.scale || 1.0;
        
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(u.x, u.y, 28 * scale, 0, Math.PI*2); ctx.fill();
        ctx.font = (44 * scale) + 'px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(u.icon, u.x, u.y);
        drawBar(u.x, u.y - (48 * scale), 48 * scale, 8, u.hp, u.maxHp, '#0f0');
    });

    simState.projectiles.forEach(p => {
        if (!isHost) { p.x += p.vx * dt * 400; p.y += p.vy * dt * 400; }
        ctx.fillStyle = '#ffff00'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI*2); ctx.fill();
    });
    
    simState.effects.forEach(e => {
        if (e.type === 'hit') { ctx.fillStyle = `rgba(255, 255, 255, ${e.timer * 2})`; ctx.beginPath(); ctx.arc(e.x, e.y, 20, 0, Math.PI*2); ctx.fill(); }
        else if (e.type === 'explosion') { 
            ctx.fillStyle = `rgba(255, 100, 0, ${e.timer})`; 
            ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI*2); ctx.fill(); 
            // Add shockwave ring
            ctx.strokeStyle = `rgba(255, 255, 0, ${e.timer})`;
            ctx.lineWidth = 5;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.radius * (1.5 - e.timer*0.5), 0, Math.PI*2); ctx.stroke();
        }
    });

    if (input.mode === 'ability') {
        const me = simState.players.find(x => x.id === localPlayerId);
        if (me) {
            const age = GAME_DATA.ages[me.age];
            if(age && age.special) {
                const wx = (input.mouse.x - canvas.width/2) / camera.zoom + camera.x;
                const wy = (input.mouse.y - canvas.height/2) / camera.zoom + camera.y;
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'; ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
                ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(wx, wy, age.special.radius, 0, Math.PI*2); ctx.stroke(); ctx.fill();
            }
        }
    }
    ctx.restore();
}

function drawBar(x, y, w, h, val, max, color) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - w/2, y, w, h);
    ctx.fillStyle = color; const fill = Math.max(0, (val / max) * w); ctx.fillRect(x - w/2, y, fill, h);
}

// Input Listeners
let isDragging = false, lastPos = {x:0, y:0};
let input = { keys: {}, mouse: { x: 0, y: 0, down: false }, targetId: null, mode: 'select' }; 

const getPos = (e) => {
    if (e.changedTouches) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
};
const onDown = (e) => {
    if (e.button === 2) { 
        input.mode = 'select'; document.body.style.cursor = 'default';
        return;
    }
    isDragging = false;
    const p = getPos(e);
    input.mouse.down = true; input.mouse.x = p.x; input.mouse.y = p.y; lastPos = p;
};
const onMove = (e) => {
    e.preventDefault(); 
    const p = getPos(e); input.mouse.x = p.x; input.mouse.y = p.y;
    if (input.mouse.down) {
        const dx = p.x - lastPos.x; const dy = p.y - lastPos.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) isDragging = true;
        if (isDragging) { camera.x -= dx / camera.zoom; camera.y -= dy / camera.zoom; lastPos = p; }
    }
};
const onUp = (e) => {
    input.mouse.down = false;
    if (!isDragging && e.button === 0) handleInput();
    isDragging = false;
};

function handleInput() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (input.mouse.x - rect.left - canvas.width/2) / camera.zoom + camera.x;
    const my = (input.mouse.y - rect.top - canvas.height/2) / camera.zoom + camera.y;

    if (input.mode === 'ability') {
        if (typeof Network !== 'undefined' && Network.sendAction) {
            Network.sendAction({ type: 'special', x: mx, y: my });
        }
        input.mode = 'select';
        document.body.style.cursor = 'default';
        return;
    }

    let clickedBase = null;
    simState.players.forEach(p => { if (dist(mx, my, p.x, p.y) < GAME_DATA.baseRadius) clickedBase = p; });

    if (clickedBase && clickedBase.id !== localPlayerId) {
        if (activeSettings.mode === 'TEAMS' && isTeammate(localPlayerId, clickedBase.id, simState.players)) {
            const ts = document.getElementById('target-status');
            ts.innerText = "Cannot Attack Teammate!";
            ts.className = "glass-panel px-6 py-3 rounded font-bold text-xl text-yellow-500 pointer-events-auto";
            setTimeout(updateUI, 1000);
        } else {
            if (typeof Network !== 'undefined' && Network.sendAction) {
                Network.sendAction({ type: 'setTarget', targetId: clickedBase.id });
            }
        }
    }
}

