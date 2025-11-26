let currentRenderedAge = -1;
let lastQueueHash = "";
let lastLobbyStateStr = "";
let gameOverInterval = null;

function initUI() {
    const nameInput = document.getElementById('lobby-name');
    if(nameInput) {
        const names = ["Warlord", "Strategist", "Commander", "General", "Captain", "Tactician", "Emperor", "King"];
        nameInput.value = names[Math.floor(Math.random() * names.length)] + " " + Math.floor(Math.random() * 1000);
    }
    const colorInput = document.getElementById('player-color');
    if(colorInput) {
        colorInput.value = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function updateUI() {
    if (!localPlayerId || !simState) return;
    const p = simState.players.find(x => x.id === localPlayerId);
    if (!p) return;

    const ageIndex = p.age;
    const ageData = GAME_DATA.ages[ageIndex];
    const nextAge = GAME_DATA.ages[ageIndex + 1];

    let displayGold = p.gold;
    // Adjust display gold based on pending actions
    if (typeof isHost !== 'undefined' && !isHost && typeof pendingQueue !== 'undefined') {
        pendingQueue.forEach(req => { displayGold -= req.cost; });
    }
    
    document.getElementById('stats-gold').innerText = Math.floor(Math.max(0, displayGold));
    document.getElementById('stats-xp').innerText = Math.floor(p.xp);
    
    // --- QUEUE UI ---
    const queueDiv = document.getElementById('queue-bar');
    
    let displayQueue = p.spawnQueue ? [...p.spawnQueue] : [];
    if (typeof pendingQueue !== 'undefined') {
        const mappedPending = pendingQueue.map(pq => ({ unitId: pq.unitId, isPending: true, startTime: pq.startTime }));
        displayQueue = displayQueue.concat(mappedPending);
    }

    const currentQueueHash = displayQueue.map(i => i.unitId + (i.isPending?'p':'')).join(',');
    
    if (displayQueue.length > 0) {
        // queueDiv.classList.remove('hidden'); // Reserved space now
        
        if (currentQueueHash !== lastQueueHash) {
            lastQueueHash = currentQueueHash;
            queueDiv.innerHTML = displayQueue.map((item, idx) => {
                const uStats = getUnitStats(p.age, item.unitId);
                if (!uStats) return '';
                const opacity = item.isPending ? 'opacity-70' : '';
                const progBar = idx === 0 ? `<div id="active-queue-prog" class="queue-progress" style="width: 100%"></div>` : '';
                return `<div class="queue-item ${opacity}">${uStats.icon}${progBar}</div>`;
            }).join('');
        }

        const progEl = document.getElementById('active-queue-prog');
        if (progEl) {
            const headItem = displayQueue[0];
            const uStats = getUnitStats(p.age, headItem.unitId);
            let pct = 0;
            if (uStats) {
                if (headItem.isPending) { 
                    const elapsed = (Date.now() - headItem.startTime) / 1000; 
                    pct = Math.min(100, Math.max(0, (elapsed / uStats.delay) * 100)); 
                } else if (typeof isHost !== 'undefined' && isHost) { 
                    pct = Math.min(100, Math.max(0, (1 - (p.spawnTimer / uStats.delay)) * 100)); 
                } else { 
                    pct = Math.min(100, Math.max(0, (1 - (p._visualTimer / uStats.delay)) * 100)); 
                }
            }
            progEl.style.width = pct + '%';
        }

    } else {
        if (lastQueueHash !== "") {
            // queueDiv.classList.add('hidden'); // Reserved space now
            queueDiv.innerHTML = '';
            lastQueueHash = "";
        }
    }

    // Unit Bar
    const unitContainer = document.getElementById('unit-bar');
    if (currentRenderedAge !== ageIndex) {
        currentRenderedAge = ageIndex;
        unitContainer.innerHTML = ageData.units.map(u => `
            <div id="btn-unit-${u.id}" class="unit-card relative w-24 h-24 rounded cursor-pointer flex flex-col items-center justify-center" 
                 onclick="handleBuyUnit('${u.id}')">
                <span class="text-5xl pointer-events-none">${u.icon}</span> 
                <span class="text-base text-yellow-400 font-bold pointer-events-none" id="cost-display-${u.id}">$${u.cost}</span>
                <div class="tooltip pointer-events-none">
                    <b class="text-yellow-400 text-xl">${u.name}</b><br/>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        <span>❤️ HP: ${u.hp}</span>
                        <span>⏱️ Train: ${u.delay}s</span>
                        <span>⚔️ Melee: ${u.meleeDmg}</span>
                        <span>🏹 Range: ${u.rangedDmg}</span>
                    </div>
                </div>
            </div>
        `).join('');

        const specialBtn = document.getElementById('special-btn');
        if (ageData.special) {
            specialBtn.innerHTML = `<span class="pointer-events-none text-4xl">⭐</span><span class="text-sm pointer-events-none">${ageData.special.name}</span><div id="special-cd-overlay" class="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center text-white font-bold hidden text-2xl"></div>`;
            specialBtn.onclick = () => { input.mode = 'ability'; document.body.style.cursor = 'crosshair'; };
            specialBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-800'); specialBtn.classList.add('bg-purple-900', 'border-purple-500', 'hover:bg-purple-800');
        } else {
            specialBtn.innerHTML = 'Locked'; specialBtn.onclick = null;
            specialBtn.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-800'); specialBtn.classList.remove('bg-purple-900', 'border-purple-500', 'hover:bg-purple-800');
        }
    }

    ageData.units.forEach(u => {
        const btn = document.getElementById(`btn-unit-${u.id}`);
        const realCost = u.cost * activeSettings.unitCost;
        document.getElementById(`cost-display-${u.id}`).innerText = '$' + Math.ceil(realCost);
        if (btn) {
            if (displayGold < realCost) btn.classList.add('disabled');
            else btn.classList.remove('disabled');
        }
    });

    const cdOverlay = document.getElementById('special-cd-overlay');
    const specialBtn = document.getElementById('special-btn');
    if (p.specialCooldown > 0 && cdOverlay) {
         cdOverlay.classList.remove('hidden'); cdOverlay.innerText = Math.ceil(p.specialCooldown);
         specialBtn.onclick = null; specialBtn.classList.add('cursor-not-allowed');
    } else if (cdOverlay) {
         cdOverlay.classList.add('hidden');
         specialBtn.onclick = () => { input.mode = 'ability'; document.body.style.cursor = 'crosshair'; };
         specialBtn.classList.remove('cursor-not-allowed');
    }

    const upgradeBtn = document.getElementById('upgrade-btn');
    if (nextAge) {
        upgradeBtn.classList.remove('hidden');
        const req = nextAge.xpReq * activeSettings.xpReq;
        const canAfford = p.xp >= req;
        
        if (canAfford) {
            upgradeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            upgradeBtn.onclick = () => { 
                if(Network && Network.sendAction) Network.sendAction({type: 'upgrade'}); 
            };
        } else {
            upgradeBtn.classList.add('opacity-50', 'cursor-not-allowed');
            upgradeBtn.onclick = null;
        }
        upgradeBtn.innerHTML = `Evolve to ${nextAge.name}<br/><span class="text-xs">${req} XP</span>`;
    } else {
        upgradeBtn.classList.add('hidden');
    }
    
    const targetStatus = document.getElementById('target-status');
    if (p.targetId) {
        const t = simState.players.find(x => x.id === p.targetId);
        targetStatus.innerText = `Target: ${t ? t.name : 'Unknown'}`;
        targetStatus.className = "glass-panel px-6 py-3 rounded font-bold text-xl text-white pointer-events-auto";
    } else {
        targetStatus.innerText = "Select Target";
        targetStatus.className = "glass-panel px-6 py-3 rounded font-bold text-xl text-red-400 animate-pulse pointer-events-auto";
    }

    // Death Notification
    if (p.hp <= 0 && !p.hasSeenDeath) {
        p.hasSeenDeath = true; // prevent looping
        const death = document.createElement('div');
        death.id = 'death-overlay';
        death.className = "absolute inset-0 flex items-center justify-center z-40 pointer-events-none";
        death.innerHTML = '<h1 class="text-8xl font-bold text-red-600 drop-shadow-[0_5px_5px_rgba(0,0,0,1)] animate-bounce">YOU DIED</h1>';
        document.body.appendChild(death);
        setTimeout(() => {
            if (death && death.parentNode) {
                death.style.transition = "opacity 2s";
                death.style.opacity = "0";
                setTimeout(() => death.remove(), 2000);
            }
        }, 3000);
    }
}

function handleBuyUnit(unitId) {
    if(typeof Network !== 'undefined' && Network.sendAction) {
        Network.sendAction({type: 'queueUnit', unitId: unitId});
    }
}

function updateLobbyUI(lobbyData) {
    if (!lobbyData) return;
    
    // Create a signature of the UI state to prevent unnecessary re-renders (fixes flickering buttons)
    const uiState = {
        hostId: lobbyData.hostId,
        players: lobbyData.players, // detailed player list
        settings: lobbyData.settings,
        status: lobbyData.status
    };
    const currentStr = JSON.stringify(uiState);
    
    if (currentStr === lastLobbyStateStr) return;
    lastLobbyStateStr = currentStr;
    
    const isHostUser = (lobbyData.hostId === localPlayerId);
    const inputs = document.querySelectorAll('#settings-panel input, #settings-panel select');
    inputs.forEach(inp => inp.disabled = !isHostUser);
    
    document.getElementById('reset-btn').classList.toggle('hidden', !isHostUser);
    document.getElementById('start-btn').classList.toggle('hidden', !isHostUser);
    document.getElementById('add-bot-btn').classList.toggle('hidden', !isHostUser);

    const lobbySettings = lobbyData.settings || DEFAULT_SETTINGS;
    
    if (!isHostUser) {
        document.getElementById('set-mode').value = lobbySettings.mode;
        document.getElementById('set-speed').value = lobbySettings.gameSpeed;
        document.getElementById('set-cost').value = lobbySettings.unitCost;
        document.getElementById('set-gold').value = lobbySettings.goldMult;
        document.getElementById('set-xp').value = lobbySettings.xpMult;
        document.getElementById('set-hp').value = lobbySettings.baseHp;
        document.getElementById('set-xpreq').value = lobbySettings.xpReq;
        document.getElementById('set-layout').value = lobbySettings.layout;
    }
    
    document.getElementById('val-speed').innerText = lobbySettings.gameSpeed + 'x';
    document.getElementById('val-cost').innerText = lobbySettings.unitCost + 'x';
    document.getElementById('val-gold').innerText = lobbySettings.goldMult + 'x';
    document.getElementById('val-xp').innerText = lobbySettings.xpMult + 'x';
    document.getElementById('val-hp').innerText = lobbySettings.baseHp;
    document.getElementById('val-xpreq').innerText = lobbySettings.xpReq + 'x';

    const teamControls = document.querySelectorAll('.team-only');
    teamControls.forEach(el => {
        if(lobbySettings.mode === 'TEAMS') el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    const list = document.getElementById('player-list');
    list.innerHTML = lobbyData.players.map(p => {
        let kickBtn = '';
        if (isHostUser && p.id !== localPlayerId) {
            // Allow removing bots or kicking real players
            kickBtn = `<button onclick="Network.kickPlayer('${p.id}')" class="btn-danger ml-2">X</button>`;
        }
        
        let teamBadge = '';
        let teamSwitch = '';
        if (lobbySettings.mode === 'TEAMS') {
            const tColor = p.team === 1 ? 'bg-blue-600' : (p.team === 2 ? 'bg-red-600' : 'bg-gray-600');
            teamBadge = `<span class="text-xs px-2 py-1 rounded ${tColor} font-bold mr-2">T${p.team}</span>`;
            
            if (p.id === localPlayerId || isHostUser) {
                 const otherTeam = p.team === 1 ? 2 : 1;
                 const otherColor = otherTeam === 1 ? 'text-blue-400' : 'text-red-400';
                 teamSwitch = `<button onclick="Network.switchTeam('${p.id}', ${otherTeam})" class="text-xs border border-gray-500 px-2 py-1 rounded hover:bg-gray-700 ml-2 ${otherColor}">Switch to T${otherTeam}</button>`;
            }
        }

        return `
        <div class="flex items-center justify-between bg-gray-700 p-2 rounded mb-1">
            <div class="flex items-center gap-2">
                ${teamBadge}
                <div class="w-3 h-3 rounded-full" style="background:${p.color}"></div>
                <span class="${p.id === localPlayerId ? 'text-yellow-300 font-bold' : ''}">${p.name} ${p.isBot ? '(BOT)' : ''}</span>
            </div>
            <div class="flex items-center">
                ${teamSwitch}
                ${p.id === lobbyData.hostId ? '<span class="text-xs text-yellow-500 mr-2 ml-2">HOST</span>' : ''}
                ${kickBtn}
            </div>
        </div>`;
    }).join('');
}

function copyLobbyId() {
    const idText = document.getElementById('display-lobby-id').innerText;
    navigator.clipboard.writeText(idText);
    const btn = document.getElementById('copy-box');
    btn.style.background = '#225522';
    setTimeout(() => { btn.style.background = ''; }, 200);
}

function enterLobbyUI(id, host) {
    // Ensure game state is reset for fresh start logic
    if (typeof gameState !== 'undefined') gameState = 'waiting';
    
    // Clear any pending game over timer to prevent race conditions
    if (gameOverInterval) {
        clearInterval(gameOverInterval);
        gameOverInterval = null;
    }
    
    showScreen('waiting-room');
    document.getElementById('display-lobby-id').innerText = id;
}

function showGameOver(data, settings) {
    let resultText = "GAME OVER";
    let resultColor = "text-white";
    
    if (settings.mode === 'TEAMS') {
        const myP = data.players.find(p => p.id === localPlayerId);
        const winnerTeam = data.winnerTeam;
        if (myP && myP.team === winnerTeam) {
            resultText = "VICTORY!";
            resultColor = "text-blue-400";
        } else {
            resultText = "DEFEAT";
            resultColor = "text-red-500";
        }
    } else {
        const amIWinner = data.winner?.id === localPlayerId;
        resultText = amIWinner ? "VICTORY!" : "DEFEAT";
        resultColor = amIWinner ? "text-yellow-400" : "text-red-500";
    }
    
    const overlay = document.createElement('div');
    overlay.className = "absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center z-50 pointer-events-auto";
    
    let hostControls = '';
    if (typeof isHost !== 'undefined' && isHost) {
        hostControls = `<button onclick="if(Network && Network.resetLobby) Network.resetLobby()" class="btn-primary hover:bg-yellow-400">Return to Lobby Now</button>`;
    }

    overlay.innerHTML = `
        <h1 class="text-6xl font-bold ${resultColor} mb-4">${resultText}</h1>
        <p class="text-2xl text-white mb-4">Winner: ${data.winner?.name || (data.winnerTeam ? "Team " + data.winnerTeam : 'Unknown')}</p>
        <p class="text-xl text-gray-400 mb-8">Returning to lobby in <span id="lobby-timer" class="text-white font-bold">5</span>s...</p>
        <div class="flex gap-4">
            <button onclick="location.reload()" class="btn-primary bg-gray-600 hover:bg-gray-500">Leave Now</button>
            ${hostControls}
        </div>
    `;
    document.body.appendChild(overlay);

    // Timer Logic
    if (gameOverInterval) clearInterval(gameOverInterval);
    
    let timeLeft = 5;
    const timerEl = document.getElementById('lobby-timer');
    gameOverInterval = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameOverInterval);
            gameOverInterval = null;
            if (isHost && typeof Network !== 'undefined' && Network.resetLobby) {
                Network.resetLobby();
            }
        }
    }, 1000);
}

