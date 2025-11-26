// Offline Network Adapter (Shared LocalStorage for Multi-Window)

const OfflineAdapter = {
    STORAGE_KEY_PREFIX: 'aow_lobby_',
    STORAGE_KEY_ACTIONS: 'aow_actions_',
    
    currentLobbyId: null,
    lobbyUnsub: null,
    syncRate: 0.05, // 50ms updates for smooth local play
    
    browserInterval: null,

    initApp: function() {
        console.log("Initializing Offline Mode...");
        
        // Generate random ID for this session (tab)
        if (!sessionStorage.getItem('offline_player_id')) {
            sessionStorage.setItem('offline_player_id', 'player_' + Math.floor(Math.random() * 10000));
        }
        localPlayerId = sessionStorage.getItem('offline_player_id');
        
        document.getElementById('auth-status').innerText = `Offline Mode (${VERSION})`;
        document.getElementById('auth-status').classList.add('text-green-500');
        document.getElementById('version-display').innerText = VERSION;
        
        showScreen('lobby-screen');
        this.startLobbyBrowser();
    },

    startLobbyBrowser: function() {
        const listEl = document.getElementById('active-lobbies-list');
        if(!listEl) return;

        // Clear existing interval if any
        if (this.browserInterval) clearInterval(this.browserInterval);

        // Poll for local lobbies
        this.browserInterval = setInterval(() => {
            listEl.innerHTML = '';
            const lobbies = [];
            const now = Date.now();
            // Scan local storage for lobbies (naive scan)
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        
                        // Cleanup: Remove ghost lobbies (> 10 mins inactive)
                        const lastHeartbeat = data.lastHeartbeat || data.createdAt || 0;
                        if (now - lastHeartbeat > 10 * 60 * 1000) {
                            localStorage.removeItem(key);
                            localStorage.removeItem(this.STORAGE_KEY_ACTIONS + key.replace(this.STORAGE_KEY_PREFIX, ''));
                            continue;
                        }

                        if (data.status === 'waiting' && !data.isPrivate) {
                            lobbies.push({ id: key.replace(this.STORAGE_KEY_PREFIX, ''), ...data });
                        }
                    } catch(e) {}
                }
            }

            if (lobbies.length === 0) {
                listEl.innerHTML = '<div class="text-gray-500 text-sm text-center">No active local games found.<br>Open another tab to play together!</div>';
                return;
            }

            lobbies.forEach(lobby => {
                const el = document.createElement('div');
                el.className = 'lobby-list-item bg-gray-800 border border-gray-600 p-2 rounded flex justify-between items-center';
                const modeLabel = lobby.settings?.mode === 'TEAMS' ? '<span class="text-xs bg-purple-600 px-1 rounded ml-2">TEAMS</span>' : '';
                el.innerHTML = `
                    <div>
                        <div class="font-bold text-yellow-500">${lobby.name} ${modeLabel}</div>
                        <div class="text-xs text-gray-400">Players: ${lobby.players.length}</div>
                    </div>
                    <button class="bg-blue-600 text-xs px-2 py-1 rounded">Join</button>
                `;
                el.onclick = () => {
                    document.getElementById('lobby-id-input').value = lobby.id;
                    this.joinLobby();
                };
                listEl.appendChild(el);
            });
        }, 2000);
    },

    stopLobbyBrowser: function() {
        if (this.browserInterval) {
            clearInterval(this.browserInterval);
            this.browserInterval = null;
        }
    },

    createLobby: function() {
        this.stopLobbyBrowser();
        const lobbyNameVal = document.getElementById('lobby-name').value || "Offline Game";
        const playerNameVal = document.getElementById('lobby-name').value || "Player 1";
        const colorVal = document.getElementById('player-color').value || "#ff0000";
        const isPrivate = document.getElementById('is-private-lobby').checked;
        
        const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.currentLobbyId = shortCode;
        
        const initialPlayer = createPlayerObj(localPlayerId, playerNameVal, false, colorVal);
        initialPlayer.team = 1;

        const lobbyData = {
            hostId: localPlayerId,
            name: lobbyNameVal,
            status: 'waiting',
            isPrivate: isPrivate,
            players: [initialPlayer],
            settings: { ...DEFAULT_SETTINGS },
            createdAt: Date.now(),
            lastHeartbeat: Date.now(),
            stateJSON: JSON.stringify({ units: [], projectiles: [], effects: [] }),
        };

        localStorage.setItem(this.STORAGE_KEY_PREFIX + shortCode, JSON.stringify(lobbyData));
        localStorage.setItem(this.STORAGE_KEY_ACTIONS + shortCode, JSON.stringify([]));

        isHost = true;
        enterLobbyUI(shortCode, true);
        this.subscribeToLobby(shortCode);
    },

    joinLobby: function() {
        this.stopLobbyBrowser();
        let id = document.getElementById('lobby-id-input').value.trim();
        const playerNameVal = document.getElementById('lobby-name').value || "Player";
        const colorVal = document.getElementById('player-color').value || "#00ff00";

        if(!id) return alert("Enter Lobby ID");
        if (id.length <= 8) id = id.toUpperCase();
        
        const key = this.STORAGE_KEY_PREFIX + id;
        const dataStr = localStorage.getItem(key);
        if(!dataStr) return alert("Lobby not found");
        
        const data = JSON.parse(dataStr);
        if(data.status !== 'waiting') return alert("Game already started");

        const currentPlayers = data.players;
        if (currentPlayers.find(p => p.id === localPlayerId)) {
             // Already in?
        } else {
            if (currentPlayers.length >= 10) return alert("Lobby Full");
            
            const t1Count = currentPlayers.filter(p => p.team === 1).length;
            const t2Count = currentPlayers.filter(p => p.team === 2).length;
            const autoTeam = t1Count <= t2Count ? 1 : 2;

            const newPlayer = createPlayerObj(localPlayerId, playerNameVal, false, colorVal);
            newPlayer.team = autoTeam; 
            
            currentPlayers.push(newPlayer);
            data.players = currentPlayers;
            localStorage.setItem(key, JSON.stringify(data));
        }

        this.currentLobbyId = id;
        isHost = false;
        enterLobbyUI(id, false);
        this.subscribeToLobby(id);
    },

    subscribeToLobby: function(id) {
        const key = this.STORAGE_KEY_PREFIX + id;
        
        const checkUpdate = () => {
            const dataStr = localStorage.getItem(key);
            if(!dataStr) { 
                alert("Lobby closed."); 
                this.leaveLobby(); // Cleanup listeners
                return; 
            }
            const data = JSON.parse(dataStr);
            
            const amIIn = data.players.find(p => p.id === localPlayerId);
            if (!amIIn) { alert("You have been kicked."); this.leaveLobby(); return; }

            isHost = (data.hostId === localPlayerId);
            updateLobbyUI(data);

            // Prevent duplicate game starts or returns to lobby
            if(data.status === 'playing' || data.status === 'paused') {
                if (typeof gameState !== 'undefined' && gameState === 'waiting') {
                    // Only transition if we were waiting
                    startGameSimulation(data);
                    gameState = 'playing';
                    showScreen('game-screen');
                    if (!canvas) initRenderer();
                }

                // Sync logic (Client Side)
                if (!isHost) {
                     document.getElementById('connection-overlay').classList.toggle('hidden', data.status !== 'paused');
                     if(data.stateJSON) {
                        const parsed = JSON.parse(data.stateJSON);
                        
                        // Sync players
                        data.players.forEach(serverPlayer => {
                            const localP = simState.players.find(p => p.id === serverPlayer.id);
                            if (localP) {
                                localP.gold = serverPlayer.gold;
                                localP.xp = serverPlayer.xp;
                                localP.hp = serverPlayer.hp;
                                localP.age = serverPlayer.age;
                                localP.targetId = serverPlayer.targetId;
                                localP.spawnQueue = serverPlayer.spawnQueue;
                                localP.specialCooldown = serverPlayer.specialCooldown;
                                
                                if (serverPlayer.spawnQueue.length > 0 && Math.abs((localP._visualTimer || 0) - serverPlayer.spawnTimer) > 0.3) {
                                    localP._visualTimer = serverPlayer.spawnTimer;
                                }
                            }
                        });
                        if (simState.players.length === 0) simState.players = data.players;
                        
                        // Sync Pending Queue
                        const me = simState.players.find(p => p.id === localPlayerId);
                        if(me && me.spawnQueue) {
                            const sIds = new Set(me.spawnQueue.map(i => i.reqId));
                            pendingQueue = pendingQueue.filter(p => !sIds.has(p.reqId));
                        }

                        // simState.projectiles = parsed.projectiles; // Don't overwrite
                        if (parsed.events) {
                             parsed.events.forEach(e => processSyncEvent(e));
                        }
                        
                        // Sync Units
                        parsed.units.forEach(serverUnit => {
                            if (renderState.units.has(serverUnit.id)) {
                                const u = renderState.units.get(serverUnit.id);
                                // Soft Sync for offline too (though lag is low)
                                u.targetId = serverUnit.targetId;
                                u.hp = serverUnit.hp;
                                u.maxHp = serverUnit.maxHp;
                                if (serverUnit.scale) u.scale = serverUnit.scale;
                                
                                // Offline sync is fast (50ms), so strict snap is fine, but let's consistent logic
                                const distSq = (u.x - serverUnit.x)**2 + (u.y - serverUnit.y)**2;
                                if (distSq > 20 * 20) { // Tighter threshold for offline
                                    u.x = serverUnit.x;
                                    u.y = serverUnit.y;
                                }
                            } else {
                                renderState.units.set(serverUnit.id, { 
                                    ...serverUnit, 
                                    x: serverUnit.x, y: serverUnit.y, 
                                    // targetX: serverUnit.x, targetY: serverUnit.y,
                                    scale: serverUnit.scale || 1.0 
                                });
                            }
                        });
                        const serverIds = new Set(parsed.units.map(u => u.id));
                        for (let [id, u] of renderState.units) { if (!serverIds.has(id)) renderState.units.delete(id); }
                        simState.units = Array.from(renderState.units.values());
                    }
                }
            } else if (data.status === 'finished') {
                if ((typeof gameState !== 'undefined' && gameState !== 'finished') || !document.querySelector('.bg-black.bg-opacity-80')) {
                    showGameOver(data, data.settings);
                    gameState = 'finished';
                }
            } else if (data.status === 'waiting') {
                if (typeof gameState !== 'undefined' && (gameState === 'finished' || gameState === 'playing')) {
                    gameState = 'waiting';
                    resetSimState();
                    document.getElementById('death-overlay')?.remove();
                    document.querySelector('.bg-black.bg-opacity-80')?.remove();
                    enterLobbyUI(this.currentLobbyId, isHost);
                }
            }
        };

        // Initial check
        checkUpdate();

        // Listener
        this.storageListener = (e) => {
            if(e.key === key) checkUpdate();
        };
        window.addEventListener('storage', this.storageListener);
        
        // Also poll because 'storage' event DOES NOT fire on the same window that made changes
        // This is fine for clients, but if we want single-window testing or just robustness:
        this.pollInterval = setInterval(checkUpdate, 100); 
    },

    sendAction: function(data) {
        if (!this.currentLobbyId) return;
        const now = Date.now();
        const reqId = localPlayerId + '_' + now + '_' + Math.random();
        const payload = { ...data, playerId: localPlayerId, reqId: reqId };

        const key = this.STORAGE_KEY_ACTIONS + this.currentLobbyId;
        
        if (data.type === 'queueUnit') {
             if (!isHost) {
                const p = simState.players.find(x => x.id === localPlayerId);
                if(p) {
                    const stats = getUnitStats(p.age, data.unitId);
                    const cost = stats.cost * activeSettings.unitCost;
                    pendingQueue.push({ unitId: data.unitId, reqId: reqId, timestamp: now, cost: cost, startTime: now });
                    updateUI();
                }
            }
        }

        // Read-Modify-Write Actions
        // Naive lock-free, acceptable for local test
        const actionsStr = localStorage.getItem(key) || '[]';
        const actions = JSON.parse(actionsStr);
        actions.push(payload);
        localStorage.setItem(key, JSON.stringify(actions));
    },

    fetchAndClearActions: async function() {
        if (!this.currentLobbyId) return [];
        const key = this.STORAGE_KEY_ACTIONS + this.currentLobbyId;
        
        const actionsStr = localStorage.getItem(key);
        if (!actionsStr || actionsStr === '[]') return [];
        
        const actions = JSON.parse(actionsStr);
        localStorage.setItem(key, '[]'); // Clear
        return actions;
    },

    syncState: function(players, stateJSON) {
        if (!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        
        // Safety: Don't write empty player list if we are host and connected
        if (players.length === 0 && isHost) return;
        
        const dataStr = localStorage.getItem(key);
        if (!dataStr) return;
        
        const data = JSON.parse(dataStr);
        data.players = players;
        data.stateJSON = stateJSON;
        data.lastHeartbeat = Date.now();
        
        localStorage.setItem(key, JSON.stringify(data));
    },

    endGame: function(result) {
        if (!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        data.status = 'finished';
        data.winner = result.winner;
        data.winnerTeam = result.winnerTeam;
        
        localStorage.setItem(key, JSON.stringify(data));
    },

    resetLobby: function() {
        if (!this.currentLobbyId || !isHost) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        data.status = 'waiting';
        data.stateJSON = JSON.stringify({ units: [], projectiles: [], effects: [] });
        delete data.winner;
        delete data.winnerTeam;
        
        // Reset player stats (keep bots)
        data.players.forEach(p => {
             const defaultP = createPlayerObj(p.id, p.name, p.isBot, p.color);
             p.gold = defaultP.gold;
             p.xp = defaultP.xp;
             p.hp = defaultP.hp;
             p.maxHp = defaultP.maxHp;
             p.age = defaultP.age;
             p.targetId = null;
             p.spawnQueue = [];
             p.spawnTimer = 0;
             p.turrets = defaultP.turrets;
        });

        data.lastHeartbeat = Date.now();
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(this.STORAGE_KEY_ACTIONS + this.currentLobbyId, '[]');
    },

    // Host Actions
    updateLobbySettings: function() {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        data.settings = {
            mode: document.getElementById('set-mode').value,
            gameSpeed: parseFloat(document.getElementById('set-speed').value),
            unitCost: parseFloat(document.getElementById('set-cost').value),
            goldMult: parseFloat(document.getElementById('set-gold').value),
            xpMult: parseFloat(document.getElementById('set-xp').value),
            baseHp: parseInt(document.getElementById('set-hp').value),
            xpReq: parseFloat(document.getElementById('set-xpreq').value),
            layout: document.getElementById('set-layout').value
        };
        localStorage.setItem(key, JSON.stringify(data));
    },

    kickPlayer: function(targetId) {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        data.players = data.players.filter(p => p.id !== targetId);
        localStorage.setItem(key, JSON.stringify(data));
    },

    switchTeam: function(targetId, newTeam) {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        const p = data.players.find(x => x.id === targetId);
        if (p) {
            p.team = newTeam;
            localStorage.setItem(key, JSON.stringify(data));
        }
    },

    addBot: function() {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        if(data.players.length >= 10) return alert("Lobby full");
        
        const t1 = data.players.filter(p => p.team === 1).length;
        const t2 = data.players.filter(p => p.team === 2).length;
        const botTeam = t1 <= t2 ? 1 : 2;

        const bot = createPlayerObj('bot_' + Date.now(), "Bot " + Math.floor(Math.random()*100), true, `hsl(${Math.random() * 360}, 70%, 50%)`);
        bot.team = botTeam;
        data.players.push(bot);
        localStorage.setItem(key, JSON.stringify(data));
    },

    setGameStarted: function() {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        // Force status update and timestamp to prevent 'waiting' state race conditions
        data.status = 'playing';
        data.lastHeartbeat = Date.now();
        localStorage.setItem(key, JSON.stringify(data));
    },

    setGamePaused: function(isPaused) {
        if(!this.currentLobbyId) return;
        const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
        const data = JSON.parse(localStorage.getItem(key));
        
        data.status = isPaused ? 'paused' : 'playing';
        data.lastHeartbeat = Date.now();
        localStorage.setItem(key, JSON.stringify(data));
    },

     leaveLobby: function() {
         if (this.currentLobbyId) {
              const key = this.STORAGE_KEY_PREFIX + this.currentLobbyId;
              try {
                  const data = JSON.parse(localStorage.getItem(key));
                  if (data) {
                      const remainingPlayers = data.players.filter(p => p.id !== localPlayerId);
                      const humanPlayers = remainingPlayers.filter(p => !p.isBot);
                      
                      if (remainingPlayers.length === 0 || humanPlayers.length === 0) {
                          localStorage.removeItem(key);
                          localStorage.removeItem(this.STORAGE_KEY_ACTIONS + this.currentLobbyId);
                      } else {
                          data.players = remainingPlayers; // Update players!
                          if (data.hostId === localPlayerId) data.hostId = humanPlayers[0].id;
                          localStorage.setItem(key, JSON.stringify(data));
                      }
                  }
              } catch(e) {}
         }
         
         if (this.storageListener) window.removeEventListener('storage', this.storageListener);
         if (this.pollInterval) clearInterval(this.pollInterval);
        
        this.currentLobbyId = null;
        showScreen('lobby-screen');
        this.startLobbyBrowser(); // Restart browser
    }
};

// Export as global Network
window.Network = OfflineAdapter;
