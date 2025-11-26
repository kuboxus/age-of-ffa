let canvas, ctx;
let camera = { x: 0, y: 0, zoom: 0.8 };
let renderState = {
    units: new Map(), 
    projectiles: [] 
};
const spriteCache = new Map(); // For potential future image loading

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

function drawSprite(ctx, source, x, y, size, color, flipX = false, seed = null) {
    ctx.save();
    
    // Animation Math
    const time = Date.now();
    const speed = 0.005;
    // Randomize phase based on seed (if provided) or x+y (for static objects)
    // Using x+y for moving objects causes animation speed changes (doppler effect), so we use a stable seed for units.
    const phase = (seed !== null) ? seed : (x + y) * 0.1;
    
    // Scale Y: 1.0 +/- 0.1 (90% to 110%)
    const scaleY = 1.0 + Math.sin(time * speed + phase) * 0.1;
    const scaleX = flipX ? -1 : 1;
    
    // Rotation: +/- 10 degrees (approx 0.17 radians)
    const rotation = Math.sin(time * speed * 0.7 + phase) * 0.17; 

    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);

    // Check if source is likely an image URL (basic check)
    if (source.includes('/') || source.includes('.') || source.startsWith('data:')) {
        // Image logic (placeholder for future)
        // For now, fallback to text if load fails or not implemented fully
        // If we had an asset manager, we'd use it here.
        // let img = spriteCache.get(source);
        // if (!img) { img = new Image(); img.src = source; spriteCache.set(source, img); }
        // if (img.complete) {
        //    ctx.drawImage(img, -size/2, -size, size, size);
        // }
        // Fallback to emoji for now since we don't have assets
        ctx.fillStyle = color;
        ctx.font = size + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Draw at (0,0) which is the anchor point (feet).
        // Shift up slightly to center vertically relative to the circle
        ctx.fillText(source, 0, size * 0.1); 
    } else {
        // Emoji / Text
        ctx.fillStyle = color;
        ctx.font = size + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Fix: standard emojis with 'middle' baseline need to be drawn slightly lower 
        // to visually center them in the circle.
        // Previously it was 'bottom' and size*0.1
        // Let's try 'middle' and offset by size * 0.1
        ctx.fillText(source, 0, size * 0.15); 
    }

    ctx.restore();
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
            // Draw Turret Base Circle
            ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, Math.PI*2); ctx.fill(); 
            
            // Draw Turret Sprite with Animation
            drawSprite(ctx, tData.icon, p.x, p.y, 48, '#fff');
        } else {
            // Draw Base Sprite (Default Castle)
            drawSprite(ctx, "🏰", p.x, p.y, 64, '#fff');
        }

        drawBar(p.x, p.y - GAME_DATA.baseRadius - 15, 120, 12, p.hp, p.maxHp, '#0f0');
        
        // Player Name
        ctx.save();
        ctx.fillStyle = '#fff'; 
        // Scale name with zoom but clamp to reasonable limits so it's readable but not huge
        // Base size 24, scaled by 1/zoom slightly to keep it somewhat constant on screen? 
        // User asked for scaling WITH zoom (so it gets bigger when you zoom in).
        // Default text behavior scales with context, so just setting a larger font size works.
        ctx.font = 'bold 32px Arial'; 
        ctx.textAlign = 'center'; 
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.lineWidth = 3;
        ctx.strokeText(p.name, p.x, p.y - GAME_DATA.baseRadius - 35);
        ctx.fillText(p.name, p.x, p.y - GAME_DATA.baseRadius - 35);
        ctx.restore();
    });

    const unitsToDraw = isHost ? simState.units : Array.from(renderState.units.values());
    unitsToDraw.forEach(u => {
        // On client, u is now updated by updateClientLogic/updateUnit, so we draw it directly.
        // Server sync updates u.x/u.y periodically to correct drift.
        // No extra interpolation needed here if simulation is running.
        
        const p = simState.players.find(pl => pl.id === u.ownerId);
        const color = p ? p.color : '#fff';
        const scale = u.scale || 1.0;
        
        // Determine facing (Default emoji faces Left)
        let flipX = false;
        if (Math.abs(u.vx) > 0.1) {
            flipX = u.vx > 0; // If moving Right (vx > 0), flip to face Right
        } else if (u.targetId) {
             // If stationary, face target
             let t = simState.players.find(pl => pl.id === u.targetId);
             if (!t) {
                 if (renderState.units.has(u.targetId)) t = renderState.units.get(u.targetId);
                 else if (simState.units) t = simState.units.find(un => un.id === u.targetId);
             }
             if (t) {
                 flipX = t.x > u.x;
             }
        }
        
        // Generate stable seed from ID for consistent animation speed regardless of movement
        let seed = 0;
        if (u.id) {
            for(let i=0; i<u.id.length; i++) seed += u.id.charCodeAt(i);
        }
        
        // Draw Unit Sprite with Animation
        drawSprite(ctx, u.icon, u.x, u.y, 44 * scale, color, flipX, seed);
        
        drawBar(u.x, u.y - (48 * scale), 48 * scale, 8, u.hp, u.maxHp, '#0f0');
    });

    simState.projectiles.forEach(p => {
        // Movement is handled in game-logic.js (host or client prediction)
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

