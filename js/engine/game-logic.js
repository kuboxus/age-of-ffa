// --- Game Logic & Simulation ---

let simState = { players: [], units: [], projectiles: [], effects: [] };
// pendingQueue is defined in state.js
let gameState = null;
// gameLoopRef is defined in state.js
let lastTime = 0;
let accumulator = 0;
let syncTimer = 0;
let syncEvents = []; // Accumulate effects to send as events
const TICK_RATE = 1 / 30; 

function resetSimState() {
    simState = { players: [], units: [], projectiles: [], effects: [] };
    syncEvents = [];
    gameState = 'waiting';
    accumulator = 0;
    syncTimer = 0;
}

function startGameSimulation(initialData) {
    resetSimState();
    activeSettings = initialData.settings || DEFAULT_SETTINGS;
    simState.players = initialData.players;
    
    // --- MAP POSITIONING LOGIC (DETERMINISTIC) ---
    if (activeSettings.mode === 'TEAMS') {
        simState.players.sort((a,b) => {
            if (a.team !== b.team) return a.team - b.team;
            return a.id.localeCompare(b.id);
        });
        
        if (activeSettings.layout === 'alternating') {
            const t1 = simState.players.filter(p => p.team === 1);
            const t2 = simState.players.filter(p => p.team === 2);
            const combined = [];
            const maxLen = Math.max(t1.length, t2.length);
            for(let i=0; i<maxLen; i++) {
                if(t1[i]) combined.push(t1[i]);
                if(t2[i]) combined.push(t2[i]);
            }
            simState.players = combined;
        }
    } else {
         simState.players.sort((a,b) => a.id.localeCompare(b.id));
    }

    const radius = GAME_DATA.mapRadius * 0.8;
    const center = { x: 0, y: 0 };
    const angleStep = (Math.PI * 2) / simState.players.length;
    
    simState.players.forEach((p, i) => {
        const angle = angleStep * i;
        p.x = center.x + Math.cos(angle) * radius;
        p.y = center.y + Math.sin(angle) * radius;
        
        p.maxHp = activeSettings.baseHp;
        p.hp = activeSettings.baseHp;
        
        // Default Auto-Target Logic
        // Target the next player in the list (clockwise) or previous (counter-clockwise)
        // In a circle, (i + 1) % length is the next neighbor.
        if (simState.players.length > 1) {
            const targetIdx = (i + 1) % simState.players.length;
            const targetP = simState.players[targetIdx];
            
            if (activeSettings.mode === 'TEAMS') {
                // If next neighbor is teammate, look for first enemy
                const enemies = simState.players.filter(e => e.team !== p.team);
                if (enemies.length > 0) {
                    // Simple heuristic: pick closest enemy or random enemy
                    // Since we are in a circle, finding the 'next' enemy in rotation is good.
                    // Let's just pick the first valid enemy for simplicity or closest
                    let closest = null; 
                    let minD = Infinity;
                    enemies.forEach(e => {
                        const d = dist(p.x, p.y, e.x, e.y);
                        if(d < minD) { minD = d; closest = e; }
                    });
                    if (closest) p.targetId = closest.id;
                }
            } else {
                // FFA: Target neighbor
                p.targetId = targetP.id;
            }
        }

        if (activeSettings.mode === 'TEAMS' && p.team > 0) {
             p.color = TEAMS[p.team].color;
        }

        const ageData = GAME_DATA.ages[p.age];
        if(ageData && ageData.turret) {
             p.turrets = [{ id: 'base_turret', typeId: ageData.turret.id, cooldown: 0, slot: 0 }];
        }
        if(p._visualTimer === undefined) p._visualTimer = 0;
    });

    // Handle visibility change to notify pause state
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (isHost && (gameState === 'playing' || gameState === 'waiting' || gameState === 'connecting')) {
                // Notify players of pause
                if (typeof Network !== 'undefined' && Network.setGamePaused) {
                     Network.setGamePaused(true);
                }
            }
        } else {
            if (isHost && (gameState === 'playing' || gameState === 'paused')) {
                lastTime = performance.now(); // Reset timer to prevent huge dt jump
                gameLoopRef = requestAnimationFrame(hostGameLoop);
                // Notify players of resume
                if (typeof Network !== 'undefined' && Network.setGamePaused) {
                     Network.setGamePaused(false);
                }
            }
        }
    });

    if (isHost) {
        lastTime = performance.now();
        gameLoopRef = requestAnimationFrame(hostGameLoop);
    } else {
        lastClientTime = performance.now();
        gameLoopRef = requestAnimationFrame(clientRenderLoop);
    }
}

function hostGameLoop(time) {
    if (gameState === 'finished') return;
    if (document.hidden) { 
        // Ensure lastTime is updated when paused to prevent jumps on resume
        // But don't update simulation
        lastTime = performance.now();
        return; 
    }

    let dt = (time - lastTime) / 1000;
    lastTime = time;
    
    const MAX_DT = 0.25;
    if (dt > MAX_DT) dt = MAX_DT;
    
    accumulator += dt;

    // Safety cap for accumulator to prevent spiral of death
    if (accumulator > 1.0) accumulator = 1.0;

    while (accumulator >= TICK_RATE) {
        updateHostLogic(TICK_RATE);
        accumulator -= TICK_RATE;
    }
    
    syncTimer += dt;
    const rate = (typeof Network !== 'undefined' && Network.syncRate) ? Network.syncRate : 0.8;
    if (syncTimer > rate) { 
        hostSyncState(); 
        syncTimer = 0; 
    }

    if (typeof renderGame === 'function') renderGame(0); // 0 dt for interpolation if needed, or just render
    if (typeof updateUI === 'function') updateUI();
    
    gameLoopRef = requestAnimationFrame(hostGameLoop);
}

function updateHostLogic(dt) {
    const gameDt = dt * activeSettings.gameSpeed; 

    // Process Actions
    if (typeof Network !== 'undefined' && Network.fetchAndClearActions) {
        Network.fetchAndClearActions().then(actions => {
             actions.forEach(action => processAction(action));
        });
    }

    simState.players.forEach(p => {
        if (p.hp <= 0) { p.spawnQueue = []; return; }
        if (p.isBot) runBotLogic(p, gameDt);
        
        if (p.specialCooldown > 0) p.specialCooldown -= gameDt;

        if (p.spawnQueue.length > 0) {
            p.spawnTimer -= gameDt;
            if (p.spawnTimer <= 0 && p.spawnQueue.length > 0) {
                 const item = p.spawnQueue.shift();
                 spawnUnitReal(p.id, item.unitId);
                 if (p.spawnQueue.length > 0) {
                    const nextItem = p.spawnQueue[0];
                    const stats = getUnitStats(p.age, nextItem.unitId);
                    p.spawnTimer = stats ? stats.delay : 1.0;
                 } else { p.spawnTimer = 0; }
            }
        }
    });

    // Unit Decay for dead players
    simState.units.forEach(u => {
        const owner = simState.players.find(p => p.id === u.ownerId);
        if (owner && owner.hp <= 0) {
            const decay = u.maxHp * 0.10 * gameDt; // Decays 10% max HP per second
            u.hp -= decay;
        }
    });

    simState.units = simState.units.filter(u => u.hp > 0);
    simState.units.forEach(u => updateUnit(u, gameDt));

    simState.players.forEach(p => { if (p.hp > 0) updateTurrets(p, gameDt); });

    simState.projectiles = simState.projectiles.filter(p => {
        p.x += p.vx * gameDt * 400; p.y += p.vy * gameDt * 400;
        
        // Range Check
        if (p.startX !== undefined && p.maxDist !== undefined) {
            if (dist(p.startX, p.startY, p.x, p.y) > p.maxDist) return false;
        }

        let hit = false;
        
        const targets = simState.units.filter(u => u.ownerId !== p.ownerId && !isTeammate(u.ownerId, p.ownerId, simState.players));
        for (let t of targets) {
            if (dist(p.x, p.y, t.x, t.y) < GAME_DATA.unitCollisionRadius * (t.scale || 1.0) + 5) {
                t.hp -= p.damage;
                hit = true;
                addEffect({x: t.x, y: t.y, type: 'hit', timer: 0.5});
                if (t.hp <= 0) awardKill(p.ownerId, t);
                break;
            }
        }
        
        if (!hit) {
            simState.players.forEach(pl => {
                if (pl.id !== p.ownerId && !isTeammate(pl.id, p.ownerId, simState.players) && pl.hp > 0 && dist(p.x, p.y, pl.x, pl.y) < GAME_DATA.baseRadius) {
                    pl.hp -= p.damage;
                    hit = true;
                    if (pl.hp <= 0) pl.hp = 0; 
                }
            });
        }
        return !hit && Math.abs(p.x) < 2000 && Math.abs(p.y) < 2000; 
    });

    simState.effects = simState.effects.filter(e => { e.timer -= gameDt; return e.timer > 0; });
    
    const alivePlayers = simState.players.filter(p => p.hp > 0);
    
    if (activeSettings.mode === 'TEAMS') {
        const t1Alive = alivePlayers.some(p => p.team === 1);
        const t2Alive = alivePlayers.some(p => p.team === 2);
        
        if (!t1Alive && t2Alive) endGame({ winnerTeam: 2 });
        else if (t1Alive && !t2Alive) endGame({ winnerTeam: 1 });
        else if (!t1Alive && !t2Alive) endGame({ winnerTeam: 0 }); 
    } else {
        if (alivePlayers.length === 1 && simState.players.length > 1) {
            endGame({ winner: { id: alivePlayers[0].id, name: alivePlayers[0].name } });
        }
    }
}

function endGame(result) {
    gameState = 'finished';
    if (typeof Network !== 'undefined' && Network.endGame) {
        Network.endGame(result);
    }
}

function addEffect(effect) {
    simState.effects.push(effect);
    syncEvents.push(effect);
}

function processSyncEvent(e) {
    if (e.type === 'shoot') {
        simState.projectiles.push(e);
    } else {
        simState.effects.push(e);
    }
}

function hostSyncState() {
    if(gameState === 'finished') return;
    
    const stateJSON = JSON.stringify({
        units: simState.units.map(u => ({
            id: u.id, ownerId: u.ownerId, typeId: u.typeId, 
            x: Math.round(u.x), y: Math.round(u.y), 
            hp: u.hp, maxHp: u.maxHp, icon: u.icon,
            scale: u.scale, // Sync scale for visual size
            targetId: u.targetId // Sync target for client prediction
        })),
        // projectiles: simState.projectiles, // Don't sync projectile list to save bandwidth
        events: syncEvents // Send new events instead of full effects list
    });
    
    syncEvents = []; // Clear after sending

    if (typeof Network !== 'undefined' && Network.syncState) {
        Network.syncState(simState.players, stateJSON);
    }
}

function runBotLogic(bot, dt) {
    // 1. Analyze Threats (Defensive Awareness)
    let threateningUnits = [];
    let attackerCounts = {};
    const detectionRange = 400; // Detect enemies coming close

    simState.units.forEach(u => {
        if (u.ownerId !== bot.id && !isTeammate(u.ownerId, bot.id, simState.players)) {
             if (dist(u.x, u.y, bot.x, bot.y) < detectionRange) {
                 threateningUnits.push(u);
                 attackerCounts[u.ownerId] = (attackerCounts[u.ownerId] || 0) + 1;
             }
        }
    });

    let primaryAttacker = null;
    let maxThreats = 0;
    for(let id in attackerCounts) {
        if (attackerCounts[id] > maxThreats) {
            maxThreats = attackerCounts[id];
            primaryAttacker = id;
        }
    }

    // 2. Update Target (Priority: Defense > Weakest/Closest)
    if (primaryAttacker) {
        bot.targetId = primaryAttacker;
    } else {
        // Offensive targeting strategy
        // If current target is dead or invalid, pick a new one
        const currentTarget = simState.players.find(p => p.id === bot.targetId);
        if (!bot.targetId || !currentTarget || currentTarget.hp <= 0) {
            // Find weakest enemy or closest
            let target = null;
            let minScore = Infinity;
            
            simState.players.forEach(p => {
                if (p.id !== bot.id && !isTeammate(p.id, bot.id, simState.players) && p.hp > 0) {
                     const d = dist(bot.x, bot.y, p.x, p.y);
                     // Score based on HP (lower is better) and distance (lower is better)
                     // Weight HP more to finish off weak players
                     const score = p.hp + d * 0.5; 
                     if (score < minScore) { minScore = score; target = p; }
                }
            });
            if (target) bot.targetId = target.id;
        }
    }
    
    // 3. Age Up (Always prioritize if possible)
    const nextAge = GAME_DATA.ages[bot.age + 1];
    const req = nextAge ? nextAge.xpReq * activeSettings.xpReq : Infinity;
    
    if (nextAge && bot.xp >= req) {
         bot.age++;
         // bot.hp = Math.min(bot.hp + 500, activeSettings.baseHp); // Removed HP gain
         bot.maxHp = activeSettings.baseHp;
         bot.turrets = [{ id: 'base_turret', typeId: GAME_DATA.ages[bot.age].turret.id, cooldown: 0, slot: 0 }];
         // Don't return, can still spawn units in same frame if rich
    }

    const ageData = GAME_DATA.ages[bot.age];

    // 4. Special Ability Logic (Defensive & Offensive)
    if (bot.specialCooldown <= 0 && ageData.special) {
        // A. Defensive Nuke (High Priority)
        if (threateningUnits.length >= 3) {
             // Find center of mass of threatening units
             let avgX = 0, avgY = 0;
             threateningUnits.forEach(u => { avgX += u.x; avgY += u.y; });
             avgX /= threateningUnits.length;
             avgY /= threateningUnits.length;
             
             // Only use if it hits enough units
             // Simple check: use it
             useSpecial(bot.id, avgX, avgY);
        } 
        // B. Offensive Nuke (Existing Logic, slightly improved)
        else if (bot.targetId) {
            const t = simState.players.find(p => p.id === bot.targetId);
            if (t) {
                let nearCount = 0;
                simState.units.forEach(u => {
                    if (u.ownerId === t.id && dist(u.x, u.y, t.x, t.y) < ageData.special.radius * 1.5) nearCount++;
                });
                // Use if cluster found or base is weak and needs a finisher
                if (nearCount >= 3 || (t.hp < t.maxHp * 0.3 && Math.random() < 0.05)) {
                    useSpecial(bot.id, t.x, t.y);
                }
            }
        }
    }

    // 5. Unit Spawning Strategy (Composition & Economy)
    if (bot.spawnQueue.length < 5) {
        const unitOpts = ageData.units;
        let pick = null;
        
        if (threateningUnits.length > 0) {
             // Panic Defense Mode: Buy whatever we can afford quickly
             // Prefer Unit 2 (usually Ranged/Mid) if affordable, else Unit 1 (Cheap/Melee)
             if (unitOpts[1] && bot.gold >= unitOpts[1].cost * activeSettings.unitCost) {
                 pick = unitOpts[1];
             } else if (unitOpts[0] && bot.gold >= unitOpts[0].cost * activeSettings.unitCost) {
                 pick = unitOpts[0];
             }
        } else {
             // Economy / Wave Mode
             // Randomly decide to save for heavy units or spawn light units
             const r = Math.random();
             const heavyUnit = unitOpts[unitOpts.length - 1];
             
             if (r < 0.3) {
                 // 30% Chance: Save for Heavy Unit (Tank/Knight/etc)
                 if (bot.gold >= heavyUnit.cost * activeSettings.unitCost) {
                     pick = heavyUnit;
                 }
                 // If can't afford, pick nothing -> Saving behavior
             } else if (r < 0.6) {
                 // 30% Chance: Balanced / Mid-tier
                 const midIndex = Math.floor(unitOpts.length / 2);
                 const midUnit = unitOpts[midIndex];
                 if (bot.gold >= midUnit.cost * activeSettings.unitCost) pick = midUnit;
             } else {
                 // 40% Chance: Cheap Spam / Fill
                 const cheapUnit = unitOpts[0];
                 if (bot.gold >= cheapUnit.cost * activeSettings.unitCost) pick = cheapUnit;
             }
        }

        if (pick) {
            const realCost = pick.cost * activeSettings.unitCost;
            if (bot.gold >= realCost) {
                bot.gold -= realCost;
                bot.spawnQueue.push({ reqId: 'bot_'+Math.random(), unitId: pick.id });
                if (bot.spawnQueue.length === 1) bot.spawnTimer = pick.delay;
            }
        }
    }
}

function updateUnit(u, dt) {
    const owner = simState.players.find(p => p.id === u.ownerId);
    const targetPlayer = simState.players.find(p => p.id === u.targetId);
    const unitRadius = GAME_DATA.unitCollisionRadius * (u.scale || 1.0);
    
    if(u.cooldownTimer > 0) u.cooldownTimer -= dt * 60;

    if (!targetPlayer || targetPlayer.hp <= 0 || isTeammate(u.ownerId, targetPlayer.id, simState.players)) {
        // ... (Target finding logic) ...
        let close = null, minDist = Infinity;
        simState.players.forEach(p => {
            if (p.id !== u.ownerId && !isTeammate(p.id, u.ownerId, simState.players) && p.hp > 0) {
                const d = dist(u.x, u.y, p.x, p.y);
                if (d < minDist) { minDist = d; close = p; }
            }
        });
        if (close) u.targetId = close.id; 
        return;
    }

    let enemy = null, enemyDist = Infinity;
    const acquisitionRange = 300; 
    
    for (let other of simState.units) {
        if (other.ownerId !== u.ownerId && !isTeammate(other.ownerId, u.ownerId, simState.players)) {
            // TRUCE LOGIC:
            // If 'other' unit is targeting the SAME player (base) that 'u' is targeting, 
            // and that target player is still alive, then ignore 'other' unit as a target.
            // This prevents enemies from fighting each other while sieging a common enemy base.
            // Assumption: u.targetId is the Player ID of the base u is attacking.
            // We check if other.targetId matches u.targetId.
            // Note: Units might have targetId set to another unit ID temporarily, 
            // but generally u.targetId is the main strategic target (Player).
            
            // However, u.targetId might update to 'close.id' (nearest player) at the top of updateUnit.
            // If both units have the same strategic goal (killing Player X), they should ignore each other.
            
            // Let's check if both units have the same targetId (which is usually a Player ID).
            if (u.targetId && other.targetId === u.targetId) {
                 // Only skip if the common target is actually a Player (Base) and is alive
                 // (If they are both targeting a dead player, it's FFA again? Or they should disperse? 
                 // The user said "attacking the same base", implying base is alive.)
                 const commonTarget = simState.players.find(p => p.id === u.targetId);
                 if (commonTarget && commonTarget.hp > 0) {
                     continue; // Skip this potential enemy unit
                 }
            }

            const d = dist(u.x, u.y, other.x, other.y);
            const otherRadius = GAME_DATA.unitCollisionRadius * (other.scale || 1.0);
            const combinedRadii = unitRadius + otherRadius;
            const maxRange = Math.max(u.meleeRange, u.rangedRange);
            
            if (d <= Math.max(maxRange + combinedRadii, acquisitionRange) && d < enemyDist) {
                enemyDist = d;
                enemy = other;
            }
        }
    }
    
    if (!enemy) {
         const d = dist(u.x, u.y, targetPlayer.x, targetPlayer.y);
         const baseRadius = GAME_DATA.baseRadius;
         const maxRange = Math.max(u.meleeRange, u.rangedRange);
         
         if (d <= maxRange + unitRadius + baseRadius) {
             enemy = { type: 'base', x: targetPlayer.x, y: targetPlayer.y, id: targetPlayer.id, radius: baseRadius };
             enemyDist = d;
         }
    }

    if (enemy) {
        const enemyRadius = enemy.type === 'base' ? GAME_DATA.baseRadius : unitRadius;

        const isMeleeRange = enemyDist <= u.meleeRange + unitRadius + enemyRadius;
        const isRangedRange = u.rangedDmg > 0 && enemyDist <= u.rangedRange + unitRadius + enemyRadius;

        // Attack Logic
        if (u.cooldownTimer <= 0) {
            if (typeof isHost !== 'undefined' && isHost) { // Only Host deals damage
                if (isMeleeRange && u.meleeDmg > 0) {
                    if (enemy.type === 'base') {
                        const p = simState.players.find(pl => pl.id === enemy.id);
                        if(p) p.hp -= u.meleeDmg;
                        if (typeof AudioManager !== 'undefined') AudioManager.playSound('hit');
                    } else {
                        enemy.hp -= u.meleeDmg;
                        if(enemy.hp <= 0) awardKill(u.ownerId, enemy);
                    }
                    addEffect({x: enemy.x, y: enemy.y, type: 'hit', timer: 0.2});
                    u.cooldownTimer = 60; 
                } else if (isRangedRange) {
                    const maxRange = u.rangedRange; 
                    // Create event instead of adding to list directly for sync
                    addEffect({
                        type: 'shoot',
                        x: u.x, y: u.y, 
                        vx: (enemy.x - u.x) / dist(u.x, u.y, enemy.x, enemy.y),
                        vy: (enemy.y - u.y) / dist(u.x, u.y, enemy.x, enemy.y),
                        damage: u.rangedDmg,
                        ownerId: u.ownerId,
                        startX: u.x, startY: u.y,
                        maxDist: maxRange * 1.5
                    });
                    
                    // Also add locally for host simulation
                    simState.projectiles.push({
                        x: u.x, y: u.y, 
                        vx: (enemy.x - u.x) / dist(u.x, u.y, enemy.x, enemy.y),
                        vy: (enemy.y - u.y) / dist(u.x, u.y, enemy.x, enemy.y),
                        damage: u.rangedDmg,
                        ownerId: u.ownerId,
                        startX: u.x, startY: u.y,
                        maxDist: maxRange * 1.5
                    });

                    u.cooldownTimer = 60;
                    if (typeof AudioManager !== 'undefined') AudioManager.playSound('shoot');
                }
            }
        }

        // Movement Logic (Decoupled from Attack)
        // Stop if within attack range (for ranged) or collision range (for melee)
        let stopDist = unitRadius + enemyRadius;
        if (u.rangedDmg > 0) {
            // For ranged units, stop at max range (minus buffer to ensure valid hit)
            stopDist = u.rangedRange + unitRadius + enemyRadius - 10; 
        }

        if (enemyDist > stopDist) {
             moveUnit(u, enemy, dt);
        }

    } else {
        // Fallback movement to target player base
        // Ensure we don't walk into the base
        const d = dist(u.x, u.y, targetPlayer.x, targetPlayer.y);
        const baseRadius = GAME_DATA.baseRadius;
        const stopDist = baseRadius + unitRadius + Math.max(u.meleeRange, u.rangedRange) * 0.8; // Stop a bit before max range

        if (d > stopDist) {
            moveUnit(u, targetPlayer, dt);
        }
    }
}

function moveUnit(u, targetPlayer, dt) {
    let canMove = true;
    const step = activeSettings.gameSpeed * dt * 50; 
    const angle = Math.atan2(targetPlayer.y - u.y, targetPlayer.x - u.x);
    const nextX = u.x + Math.cos(angle) * step;
    const nextY = u.y + Math.sin(angle) * step;

    for (let other of simState.units) {
        if (other.id !== u.id) {
            const d = dist(nextX, nextY, other.x, other.y);
            const r1 = GAME_DATA.unitCollisionRadius * (u.scale || 1.0);
            const r2 = GAME_DATA.unitCollisionRadius * (other.scale || 1.0);
            if (d < r1 + r2) {
                const dx = other.x - u.x;
                const dy = other.y - u.y;
                const dot = dx * Math.cos(angle) + dy * Math.sin(angle);
                if (dot > 0) { canMove = false; break; }
            }
        }
    }

    if (canMove) { u.x = nextX; u.y = nextY; }
}

function updateTurrets(p, dt) {
    p.turrets.forEach(t => {
        const tData = getTurretData(t.typeId);
        if (!tData) return;
        
        if (t.cooldown > 0) t.cooldown -= dt * 60;
        
        if (t.cooldown <= 0) {
            let target = null;
            let minD = tData.range;
            for (let u of simState.units) {
                if (u.ownerId !== p.id && !isTeammate(u.ownerId, p.id, simState.players)) {
                    const d = dist(p.x, p.y, u.x, u.y);
                    if (d < minD) { minD = d; target = u; }
                }
            }
            
            if (target) {
                if (Math.random() < 0.3 && typeof AudioManager !== 'undefined') AudioManager.playSound('shoot');
                
                const projData = {
                    x: p.x, y: p.y,
                    vx: (target.x - p.x) / dist(p.x, p.y, target.x, target.y),
                    vy: (target.y - p.y) / dist(p.x, p.y, target.x, target.y),
                    damage: tData.damage,
                    ownerId: p.id,
                    startX: p.x, startY: p.y,
                    maxDist: tData.range * 1.5
                };

                if (typeof isHost !== 'undefined' && isHost) {
                    addEffect({ ...projData, type: 'shoot' });
                    simState.projectiles.push(projData);
                }
                
                t.cooldown = tData.cooldown;
            }
        }
    });
}

function getSpawnPosition(p) {
    let spawnX = p.x, spawnY = p.y;
    const offset = GAME_DATA.baseRadius + 20;

    if (p.targetId && !isTeammate(p.id, p.targetId, simState.players)) {
        const target = simState.players.find(tp => tp.id === p.targetId);
        if (target) {
            const a = Math.atan2(target.y - p.y, target.x - p.x);
            spawnX += Math.cos(a) * offset;
            spawnY += Math.sin(a) * offset;
            return { x: spawnX, y: spawnY };
        }
    }
    
    // Default: spawn towards center (0,0)
    const a = Math.atan2(-p.y, -p.x);
    spawnX += Math.cos(a) * offset;
    spawnY += Math.sin(a) * offset;
    return { x: spawnX, y: spawnY };
}

function spawnUnitReal(playerId, unitId) {
    const p = simState.players.find(x => x.id === playerId);
    if (!p) return;

    const stats = getUnitStats(p.age, unitId);
    const pos = getSpawnPosition(p);

    simState.units.push({
        id: Math.random().toString(36),
        ownerId: p.id,
        typeId: unitId,
        x: pos.x,
        y: pos.y,
        hp: stats.hp,
        maxHp: stats.hp,
        meleeDmg: stats.meleeDmg,
        rangedDmg: stats.rangedDmg,
        meleeRange: stats.meleeRange,
        rangedRange: stats.rangedRange,
        cooldownTimer: 0,
        targetId: p.targetId,
        icon: stats.icon,
        cost: stats.cost * activeSettings.unitCost,
        scale: stats.scale || 1.0
    });
    
    if (typeof AudioManager !== 'undefined') AudioManager.playSound('spawn');
}

function useSpecial(playerId, x, y) {
    const p = simState.players.find(x => x.id === playerId);
    if(!p) return;
    const age = GAME_DATA.ages[p.age];
    if(!age.special) return;
    if (p.specialCooldown > 0) return;

    p.specialCooldown = age.special.cooldown;
    addEffect({x, y, type: 'explosion', radius: age.special.radius, timer: 1.0});
    if (typeof AudioManager !== 'undefined') AudioManager.playSound('explosion');
    
    simState.units.forEach(u => {
        if (u.ownerId !== playerId && !isTeammate(u.ownerId, playerId, simState.players) && dist(u.x, u.y, x, y) < age.special.radius) {
            u.hp -= age.special.damage;
            if(u.hp <= 0) awardKill(playerId, u);
        }
    });
}

function awardKill(killerId, victimUnit) {
    const killer = simState.players.find(p => p.id === killerId);
    if (killer && victimUnit.cost) {
        const baseCost = victimUnit.cost / activeSettings.unitCost; 
        killer.gold += Math.ceil((baseCost * 1.3) * activeSettings.goldMult);
        killer.xp += Math.floor((baseCost * 1.0) * activeSettings.xpMult);
    }
}

function processAction(action) {
    if (action.type === 'queueUnit') {
        const p = simState.players.find(x => x.id === action.playerId);
        if (p && p.hp > 0) {
             const stats = getUnitStats(p.age, action.unitId);
             const cost = stats.cost * activeSettings.unitCost;
             if (stats && p.gold >= cost) {
                 p.gold -= cost;
                 p.spawnQueue.push({ unitId: action.unitId, reqId: action.reqId });
                 if (p.spawnQueue.length === 1) p.spawnTimer = stats.delay;
             }
        }
    } else if (action.type === 'setTarget') {
        const p = simState.players.find(x => x.id === action.playerId);
        if (p) {
            if (!isTeammate(p.id, action.targetId, simState.players)) {
                p.targetId = action.targetId;
            }
        }
    } else if (action.type === 'upgrade') {
        const p = simState.players.find(x => x.id === action.playerId);
        if (p) {
            const nextAge = GAME_DATA.ages[p.age + 1];
            const req = nextAge ? nextAge.xpReq * activeSettings.xpReq : Infinity;
            if (nextAge && p.xp >= req) {
                p.age++;
                // p.hp += 500; // Removed HP gain
                p.maxHp = activeSettings.baseHp;
                p.turrets = [{ id: 'base_turret', typeId: GAME_DATA.ages[p.age].turret.id, cooldown: 0, slot: 0 }];
                if (typeof AudioManager !== 'undefined') AudioManager.playSound('levelUp');
            }
        }
    } else if (action.type === 'special') {
         useSpecial(action.playerId, action.x, action.y);
    }
}

let lastClientTime = 0;

function updateClientLogic(dt) {
    const gameDt = dt * activeSettings.gameSpeed;

    // Predict Unit Movement
    simState.units.forEach(u => {
        if (u.hp > 0) {
            // On client, we use moveUnit to predict position based on targetId
            // We do NOT deal damage or spawn projectiles here (that's event driven or host only)
            // But we DO run moveUnit to keep them sliding towards their goal
            
            // We need to find the "enemy" or "target" just like host does for movement
            const targetPlayer = simState.players.find(p => p.id === u.targetId);
            
            // Simplified client movement logic:
            // 1. If we have a targetId (player), move towards it.
            // 2. If we have a nearby enemy unit, move towards it?
            // To keep it simple and consistent with Host:
            // We can actually run `updateUnit` but disable the attack part?
            // Yes, let's reuse updateUnit but flag it as client? 
            // I added `isHost` check inside `updateUnit` for attacks.
            // So we can just call `updateUnit(u, gameDt)`!
            updateUnit(u, gameDt);
        }
    });

    // Simulate Projectiles
    if (simState.projectiles) { // Safety check
        simState.projectiles = simState.projectiles.filter(p => {
            p.x += p.vx * gameDt * 400; p.y += p.vy * gameDt * 400;
            
            // Range Check
            if (p.startX !== undefined && p.maxDist !== undefined) {
                if (dist(p.startX, p.startY, p.x, p.y) > p.maxDist) return false;
            }

            let hit = false;
            
            // Visual hit detection only
            const targets = simState.units.filter(u => u.ownerId !== p.ownerId && !isTeammate(u.ownerId, p.ownerId, simState.players));
            for (let t of targets) {
                if (dist(p.x, p.y, t.x, t.y) < GAME_DATA.unitCollisionRadius * (t.scale || 1.0) + 5) {
                    hit = true;
                    simState.effects.push({x: t.x, y: t.y, type: 'hit', timer: 0.5});
                    break;
                }
            }
            
            if (!hit) {
                simState.players.forEach(pl => {
                    if (pl.id !== p.ownerId && !isTeammate(pl.id, p.ownerId, simState.players) && pl.hp > 0 && dist(p.x, p.y, pl.x, pl.y) < GAME_DATA.baseRadius) {
                        hit = true;
                        // simState.effects.push({x: pl.x, y: pl.y, type: 'hit', timer: 0.5}); // Optional base hit effect
                    }
                });
            }
            return !hit && Math.abs(p.x) < 2000 && Math.abs(p.y) < 2000; 
        });
    }

    simState.effects = simState.effects.filter(e => { e.timer -= gameDt; return e.timer > 0; });
}

function clientRenderLoop(time) {
    let dt = (time - lastClientTime) / 1000;
    lastClientTime = time;
    if (dt > 0.5) dt = 0.016; // Cap dt to prevent explosions on lag spikes or initialization
    
    const gameDt = dt * activeSettings.gameSpeed;
    
    if (typeof pendingQueue !== 'undefined' && pendingQueue.length > 0) {
        pendingQueue = pendingQueue.filter(p => Date.now() - p.timestamp < 5000);
    }
    simState.players.forEach(p => { 
        if (p._visualTimer > 0) p._visualTimer = Math.max(0, p._visualTimer - gameDt);
        if (p.specialCooldown > 0) p.specialCooldown = Math.max(0, p.specialCooldown - gameDt);
    });

    // Run Client Prediction
    if (gameState === 'playing') {
        updateClientLogic(dt);
    }

    if (typeof renderGame === 'function') renderGame(dt);
    if (typeof updateUI === 'function') updateUI();
    
    if (gameState !== 'finished') gameLoopRef = requestAnimationFrame(clientRenderLoop);
}

