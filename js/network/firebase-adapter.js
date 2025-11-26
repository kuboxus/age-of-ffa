// Firebase Network Adapter

const FirebaseAdapter = {
    db: null,
    auth: null,
    lobbyUnsub: null,
    browserUnsub: null,
    syncRate: 1.0, // 1.0s updates (Conserve quota), relying on client prediction

    initApp: async function() {
        const firebaseConfig = {
			apiKey: "AIzaSyAhVZB64ov5te0w5he0zeCNuOZuy7jUpuI",
			authDomain: "ageofffa.firebaseapp.com",
			projectId: "ageofffa",
			storageBucket: "ageofffa.firebasestorage.app",
			messagingSenderId: "461491837298",
			appId: "1:461491837298:web:daebae2fb46fe3eb3ee5eb"
		};
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        this.db = firebase.firestore();
        this.auth = firebase.auth();

        await this.auth.signInAnonymously();
        
        this.auth.onAuthStateChanged(u => {
            if (u) {
                localPlayerId = u.uid;
                document.getElementById('auth-status').innerText = `Connected (${VERSION})`;
                document.getElementById('auth-status').classList.add('text-green-500');
                document.getElementById('version-display').innerText = VERSION;
                showScreen('lobby-screen');
                this.startLobbyBrowser();
            }
        });
    },

    getLobbyRef: function() {
        let appId = 'default-app'; // Could be dynamic if needed
        return this.db.collection('artifacts').doc(appId).collection('public').doc('data').collection('lobbies');
    },

    startLobbyBrowser: function() {
        if(this.browserUnsub) this.browserUnsub();
        
        this.browserUnsub = this.getLobbyRef().onSnapshot(snapshot => {
            const listEl = document.getElementById('active-lobbies-list');
            if(!listEl) return;
            listEl.innerHTML = '';
            const activeLobbies = [];
            const now = Date.now(); // Timestamp check? Firestore timestamp is object.
            
            snapshot.forEach(doc => {
                const data = doc.data();
                // Filter ghost games (older than 10 mins heartbeat)
                // Note: Firestore timestamp to millis: data.lastHeartbeat.toMillis()
                let isAlive = true;
                if (data.lastHeartbeat && data.lastHeartbeat.toMillis) {
                    if (now - data.lastHeartbeat.toMillis() > 10 * 60 * 1000) isAlive = false;
                }
                
                if (isAlive && data.status === 'waiting' && !data.isPrivate) {
                    activeLobbies.push({ id: doc.id, ...data });
                }
            });
            
            if (activeLobbies.length === 0) {
                listEl.innerHTML = '<div class="text-gray-500 text-sm text-center">No active public games found.</div>';
                return;
            }

            activeLobbies.forEach(lobby => {
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
        });
    },

    stopLobbyBrowser: function() {
        if(this.browserUnsub) {
            this.browserUnsub();
            this.browserUnsub = null;
        }
    },

    createLobby: async function() {
        this.stopLobbyBrowser();
        const lobbyNameVal = document.getElementById('lobby-name').value || "New Game";
        const playerNameVal = document.getElementById('lobby-name').value || "Player 1";
        const colorVal = document.getElementById('player-color').value || "#ff0000";
        const isPrivate = document.getElementById('is-private-lobby').checked;
        
        const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        lobbyId = shortCode;
        
        const initialPlayer = createPlayerObj(localPlayerId, playerNameVal, false, colorVal);
        initialPlayer.team = 1;

        await this.getLobbyRef().doc(shortCode).set({
            hostId: localPlayerId,
            name: lobbyNameVal,
            status: 'waiting',
            isPrivate: isPrivate,
            players: [initialPlayer],
            settings: { ...DEFAULT_SETTINGS },
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp(),
            stateJSON: JSON.stringify({ units: [], projectiles: [], effects: [] }),
            actions: []
        });

        isHost = true;
        enterLobbyUI(lobbyId, true);
        this.subscribeToLobby(lobbyId);
    },

    joinLobby: async function() {
        this.stopLobbyBrowser();
        let id = document.getElementById('lobby-id-input').value.trim();
        const playerNameVal = document.getElementById('lobby-name').value || "Player";
        const colorVal = document.getElementById('player-color').value || "#00ff00";

        if(!id) return alert("Enter Lobby ID");
        if (id.length <= 8) id = id.toUpperCase();
        
        const lobbyRef = this.getLobbyRef().doc(id);
        const doc = await lobbyRef.get();
        
        if(!doc.exists) return alert("Lobby not found");
        if(doc.data().status !== 'waiting') return alert("Game already started");

        const currentPlayers = doc.data().players;
        const t1Count = currentPlayers.filter(p => p.team === 1).length;
        const t2Count = currentPlayers.filter(p => p.team === 2).length;
        const autoTeam = t1Count <= t2Count ? 1 : 2;

        const newPlayer = createPlayerObj(localPlayerId, playerNameVal, false, colorVal);
        newPlayer.team = autoTeam; 
        
        await this.db.runTransaction(async (t) => {
            const fresh = await t.get(lobbyRef);
            if (!fresh.exists) throw "Lobby gone";
            const players = fresh.data().players;
            if (players.find(p => p.id === localPlayerId)) return; 
            if (players.length >= 10) throw "Lobby Full";
            players.push(newPlayer);
            t.update(lobbyRef, { players: players });
        });

        lobbyId = id;
        isHost = false;
        enterLobbyUI(lobbyId, false);
        this.subscribeToLobby(lobbyId);
    },

    subscribeToLobby: function(id) {
        if(this.lobbyUnsub) this.lobbyUnsub();
        let hasSeenSelf = false;

        this.lobbyUnsub = this.getLobbyRef().doc(id).onSnapshot(doc => {
            if(!doc.exists) { alert("Lobby closed."); location.reload(); return; }
            const data = doc.data();
            
            const amIIn = data.players.find(p => p.id === localPlayerId);
            if (amIIn) hasSeenSelf = true;
            else if (hasSeenSelf) { alert("You have been kicked."); location.reload(); return; }

            isHost = (data.hostId === localPlayerId);
            updateLobbyUI(data);

            if(data.status === 'playing' || data.status === 'paused') {
                if (gameState === 'waiting') {
                    startGameSimulation(data);
                    gameState = 'playing';
                    showScreen('game-screen');
                    // Init renderer if not done
                    if (!canvas) initRenderer();
                }
                
                // Sync logic
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

                        // simState.projectiles = parsed.projectiles; // Don't overwrite, managed by events and simulation
                        if (parsed.events) {
                             parsed.events.forEach(e => processSyncEvent(e));
                        }
                        
                        // Sync Units (Interpolation)
                        parsed.units.forEach(serverUnit => {
                            if (renderState.units.has(serverUnit.id)) {
                                const u = renderState.units.get(serverUnit.id);
                                // Soft Sync: Update target and status, but only snap position if drift is large
                                u.targetId = serverUnit.targetId;
                                u.hp = serverUnit.hp;
                                u.maxHp = serverUnit.maxHp;
                                if (serverUnit.scale) u.scale = serverUnit.scale;
                                
                                const distSq = (u.x - serverUnit.x)**2 + (u.y - serverUnit.y)**2;
                                if (distSq > 100 * 100) { // 100px drift threshold
                                    u.x = serverUnit.x; 
                                    u.y = serverUnit.y;
                                }
                            } else {
                                renderState.units.set(serverUnit.id, { 
                                    ...serverUnit, 
                                    x: serverUnit.x, y: serverUnit.y, 
                                    // targetX: serverUnit.x, targetY: serverUnit.y, // Not used anymore
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
                if (gameState !== 'finished' || !document.querySelector('.bg-black.bg-opacity-80')) {
                    showGameOver(data, data.settings);
                    gameState = 'finished';
                }
            } else if (data.status === 'waiting') {
                if (gameState === 'finished' || gameState === 'playing') {
                    // Instead of reload, reset local state and go to waiting room
                    gameState = 'waiting';
                    resetSimState();
                    document.getElementById('death-overlay')?.remove();
                    document.querySelector('.bg-black.bg-opacity-80')?.remove();
                    enterLobbyUI(lobbyId, isHost);
                }
            }
        });
    },

    sendAction: function(data) {
        const now = Date.now();
        const reqId = localPlayerId + '_' + now + '_' + Math.random();

        if (data.type === 'queueUnit') {
            if (!isHost) {
                const p = simState.players.find(x => x.id === localPlayerId);
                const stats = getUnitStats(p.age, data.unitId);
                const cost = stats.cost * activeSettings.unitCost;
                if (p && stats && p.gold >= cost) {
                    pendingQueue.push({ unitId: data.unitId, reqId: reqId, timestamp: now, cost: cost, startTime: now });
                    updateUI();
                }
            }
        }

        const payload = { ...data, playerId: localPlayerId, reqId: reqId };
        if (isHost) {
            // Host processes directly if offline or just optimization? 
            // Original code had host processing local actions via processAction directly 
            // BUT if using Firebase, better to write to DB to maintain consistent log if we want strict server authoritative 
            // OR host is authoritative so host applies immediately.
            // Original: if (isHost) processAction(payload); else write to DB.
            processAction(payload);
        } else {
            this.getLobbyRef().doc(lobbyId).collection('requests').add({ ...payload, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        }
    },

    fetchAndClearActions: async function() {
        if (!lobbyId) return [];
        const snap = await this.getLobbyRef().doc(lobbyId).collection('requests').get();
        const actions = [];
        snap.forEach(doc => {
            actions.push(doc.data());
            doc.ref.delete();
        });
        return actions;
    },

    syncState: function(players, stateJSON) {
        if (!lobbyId) return;
        this.getLobbyRef().doc(lobbyId).update({ 
            players: players,
            stateJSON: stateJSON, 
            lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp() 
        });
    },

    endGame: function(result) {
        if (!lobbyId) return;
        this.getLobbyRef().doc(lobbyId).update({ status: 'finished', ...result });
    },

    resetLobby: async function() {
        if (!lobbyId || !isHost) return;
        
        const ref = this.getLobbyRef().doc(lobbyId);
        const doc = await ref.get();
        if (!doc.exists) return;
        let players = doc.data().players;
        
        // Reset player stats (keep bots)
        players.forEach(p => {
             const defaultP = createPlayerObj(p.id, p.name, p.isBot, p.color);
             // Preserve team if TEAMS mode? usually reset is full wipe or keep teams. Let's keep teams/names/color but reset stats.
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

        // Reset game state to waiting
        await ref.update({
            status: 'waiting',
            stateJSON: JSON.stringify({ units: [], projectiles: [], effects: [] }),
            actions: [], 
            winner: firebase.firestore.FieldValue.delete(),
            winnerTeam: firebase.firestore.FieldValue.delete(),
            players: players,
            lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // Host Actions
    updateLobbySettings: async function() {
        if(!isHost || !lobbyId) return;
        const newSettings = {
            mode: document.getElementById('set-mode').value,
            gameSpeed: parseFloat(document.getElementById('set-speed').value),
            unitCost: parseFloat(document.getElementById('set-cost').value),
            goldMult: parseFloat(document.getElementById('set-gold').value),
            xpMult: parseFloat(document.getElementById('set-xp').value),
            baseHp: parseInt(document.getElementById('set-hp').value),
            xpReq: parseFloat(document.getElementById('set-xpreq').value),
            layout: document.getElementById('set-layout').value
        };
        await this.getLobbyRef().doc(lobbyId).update({ settings: newSettings });
    },

    kickPlayer: async function(targetId) {
        if (!isHost || !lobbyId) return;
        await this.db.runTransaction(async (t) => {
             const ref = this.getLobbyRef().doc(lobbyId);
             const doc = await t.get(ref);
             const players = doc.data().players.filter(p => p.id !== targetId);
             t.update(ref, { players: players });
        });
    },

    switchTeam: async function(targetId, newTeam) {
        if (!lobbyId) return;
        await this.db.runTransaction(async (t) => {
             const ref = this.getLobbyRef().doc(lobbyId);
             const doc = await t.get(ref);
             const players = doc.data().players;
             const p = players.find(x => x.id === targetId);
             if (p) {
                 p.team = newTeam;
                 t.update(ref, { players: players });
             }
        });
    },

    addBot: async function() {
        if(!isHost) return;
        const ref = this.getLobbyRef().doc(lobbyId);
        const doc = await ref.get();
        const players = doc.data().players;
        if(players.length >= 10) return alert("Lobby full");
        
        const t1 = players.filter(p => p.team === 1).length;
        const t2 = players.filter(p => p.team === 2).length;
        const botTeam = t1 <= t2 ? 1 : 2;

        const bot = createPlayerObj('bot_' + Date.now(), "Bot " + Math.floor(Math.random()*100), true, `hsl(${Math.random() * 360}, 70%, 50%)`);
        bot.team = botTeam;
        players.push(bot);
        await ref.update({ players });
    },

    setGameStarted: async function() {
        if(!isHost) return;
        await this.getLobbyRef().doc(lobbyId).update({ 
            status: 'playing',
            lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp() 
        });
    },

    setGamePaused: async function(isPaused) {
        if(!isHost || !lobbyId) return;
        await this.getLobbyRef().doc(lobbyId).update({ 
            status: isPaused ? 'paused' : 'playing',
            lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp() 
        });
    },

     leaveLobby: async function() {
         if (!lobbyId) return;
         if (this.lobbyUnsub) this.lobbyUnsub();
         this.lobbyUnsub = null;
         const ref = this.getLobbyRef().doc(lobbyId);
         
         await this.db.runTransaction(async (t) => {
              const doc = await t.get(ref);
              if (!doc.exists) return;
              const data = doc.data();
              const remainingPlayers = data.players.filter(p => p.id !== localPlayerId);
              const humanPlayers = remainingPlayers.filter(p => !p.isBot);
 
              // Close lobby if no players left OR only bots remain
              if (remainingPlayers.length === 0 || humanPlayers.length === 0) {
                  t.delete(ref);
              } else {
                  let updates = { players: remainingPlayers };
                  if (data.hostId === localPlayerId) updates.hostId = humanPlayers[0].id;
                  t.update(ref, updates);
              }
         });
        lobbyId = null; 
        showScreen('lobby-screen'); 
        this.startLobbyBrowser();
    }
};

// Export as global Network
window.Network = FirebaseAdapter;

