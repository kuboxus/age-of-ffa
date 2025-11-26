// Firebase Network Adapter with P2P Integration

const FirebaseAdapter = {
    db: null,
    auth: null,
    lobbyUnsub: null,
    browserUnsub: null,
    signalUnsub: null,
    syncRate: 0.1, // P2P can handle fast updates (10Hz)

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
        let appId = 'default-app'; 
        return this.db.collection('artifacts').doc(appId).collection('public').doc('data').collection('lobbies');
    },

    // --- P2P Signaling ---

    // Called by P2PManager to send signals via Firebase
    sendSignal: function(targetId, data) {
        if (!lobbyId) return;
        console.log(`[Firebase] Sending signal to ${targetId}: ${data.type}`);
        this.getLobbyRef().doc(lobbyId).collection('signals').add({
            to: targetId,
            from: localPlayerId,
            data: JSON.stringify(data),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => {
            console.error("Signal Send Error:", err);
            if (err.code === 'permission-denied') {
                alert("P2P Signaling Failed: Permission Denied. Please update your Firestore Security Rules to allow access to the 'signals' subcollection.");
            }
        });
    },

    // Called by P2PManager when data is received
    onP2PData: function(senderId, data) {
        if (data.type === 'state') {
            // Received Game State from Host
            if (!isHost) {
                this.processGameState(data.payload);
            }
        } else if (data.type === 'action') {
            // Received Action from Client
            if (isHost) {
                processAction(data.payload);
            }
        }
    },

    startSignalingListener: function(isHostUser) {
        if (this.signalUnsub) this.signalUnsub();
        
        // Initialize P2P Manager
        P2PManager.init(
            localPlayerId, 
            isHostUser, 
            (targetId, data) => this.sendSignal(targetId, data), 
            (senderId, data) => this.onP2PData(senderId, data)
        );

        // Listen for signals intended for ME
        this.signalUnsub = this.getLobbyRef().doc(lobbyId).collection('signals')
            .where('to', '==', localPlayerId)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const msg = change.doc.data();
                        const payload = JSON.parse(msg.data);
                        
                        if (payload.type === 'offer') P2PManager.handleOffer(msg.from, payload.sdp);
                        else if (payload.type === 'answer') P2PManager.handleAnswer(msg.from, payload.sdp);
                        else if (payload.type === 'candidate') P2PManager.handleCandidate(msg.from, payload.candidate);
                        
                        // Cleanup signal to keep DB clean
                        change.doc.ref.delete().catch(e => console.warn("Cleanup signal failed", e)); 
                    }
                });
            }, error => {
                console.error("Signal Listener Error:", error);
                if (error.code === 'permission-denied') {
                    console.warn("Firestore rules blocked signal listener.");
                }
            });
    },

    // --- Standard Lobby Logic ---

    startLobbyBrowser: function() {
        if(this.browserUnsub) this.browserUnsub();
        
        this.browserUnsub = this.getLobbyRef().onSnapshot(snapshot => {
            const listEl = document.getElementById('active-lobbies-list');
            if(!listEl) return;
            listEl.innerHTML = '';
            const activeLobbies = [];
            const now = Date.now(); 
            
            snapshot.forEach(doc => {
                const data = doc.data();
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
            stateJSON: JSON.stringify({ units: [], projectiles: [], effects: [] }), // Placeholder
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

        // Init P2P listener immediately to catch early signals
        const isHostUser = (typeof isHost !== 'undefined') ? isHost : false; 
        // Note: isHost might update in the snapshot, but we need listeners active.
        // We'll re-init inside snapshot if host changes (rare).

        this.lobbyUnsub = this.getLobbyRef().doc(id).onSnapshot(doc => {
            if(!doc.exists) { alert("Lobby closed."); location.reload(); return; }
            const data = doc.data();
            
            const amIIn = data.players.find(p => p.id === localPlayerId);
            if (amIIn) hasSeenSelf = true;
            else if (hasSeenSelf) { alert("You have been kicked."); location.reload(); return; }

            const wasHost = isHost;
            isHost = (data.hostId === localPlayerId);
            
            // Init P2P logic if just joined or role switched
            if (!this.signalUnsub || wasHost !== isHost) {
                this.startSignalingListener(isHost);
            }

            updateLobbyUI(data);

            if(data.status === 'connecting' || data.status === 'playing' || data.status === 'paused') {
                if (typeof activeSettings !== 'undefined' && data.settings) activeSettings = data.settings;

                // Entering Game Screen from Waiting
                if (gameState === 'waiting') {
                    startGameSimulation(data);
                    gameState = 'connecting'; // Start in connecting state
                    showScreen('game-screen');
                    if (!canvas) initRenderer();

                    if (isHost) {
                        data.players.forEach(p => {
                            if (p.id !== localPlayerId && !p.isBot) {
                                P2PManager.connectToPeer(p.id);
                            }
                        });
                        
                        // Host Monitoring: Check connection progress
                        if (!this.connectionMonitorInterval) {
                            this.connectionMonitorInterval = setInterval(() => {
                                const humanPlayers = data.players.filter(p => !p.isBot && p.id !== localPlayerId).length;
                                const connected = P2PManager.getConnectionCount();
                                
                                // Force start if everyone connected or 10s timeout (handled elsewhere or manual?)
                                // Let's auto-start if connected match
                                if (connected >= humanPlayers) {
                                    clearInterval(this.connectionMonitorInterval);
                                    this.connectionMonitorInterval = null;
                                    // Transition to Playing
                                    this.getLobbyRef().doc(lobbyId).update({ status: 'playing' });
                                }
                            }, 1000);
                            
                            // Timeout safety: 10s max wait
                            setTimeout(() => {
                                if (this.connectionMonitorInterval) {
                                    clearInterval(this.connectionMonitorInterval);
                                    this.connectionMonitorInterval = null;
                                    this.getLobbyRef().doc(lobbyId).update({ status: 'playing' });
                                }
                            }, 10000);
                        }
                    }
                }
                
                // Sync State Transition
                if (data.status === 'paused') {
                    gameState = 'paused';
                } else if (data.status === 'playing') {
                    if (gameState === 'connecting' || gameState === 'paused') {
                        gameState = 'playing';
                    }
                }
                
                // Sync Logic (Fallback + P2P Status Update)
                if (!isHost) {
                    // If P2P is working, we don't need Firestore stateJSON
                    // Use connection overlay to show P2P status instead of just "paused"
                    const hostId = data.hostId;
                    const isConnected = P2PManager.isConnected(hostId);
                    const overlay = document.getElementById('connection-overlay');
                    
                    if (data.status === 'paused') {
                        overlay.classList.remove('hidden');
                        overlay.querySelector('h2').innerText = "Game Paused";
                    } else if (data.status === 'connecting' || !isConnected) {
                         overlay.classList.remove('hidden');
                         overlay.querySelector('h2').innerText = "Connecting to Host...";
                         if (data.status === 'connecting') {
                             overlay.querySelector('p').innerText = "Waiting for all players to join...";
                         } else {
                             overlay.querySelector('p').innerText = "Negotiating P2P connection...";
                         }
                    } else {
                        overlay.classList.add('hidden');
                    }
                } else {
                    // Host Overlay for Connecting
                    const overlay = document.getElementById('connection-overlay');
                    if (data.status === 'connecting') {
                        overlay.classList.remove('hidden');
                        const humanPlayers = data.players.filter(p => !p.isBot && p.id !== localPlayerId).length;
                        const connected = P2PManager.getConnectionCount();
                        overlay.querySelector('h2').innerText = "Waiting for Players";
                        overlay.querySelector('p').innerText = `${connected} / ${humanPlayers} connected...`;
                    } else if (data.status === 'paused') {
                        overlay.classList.remove('hidden');
                        overlay.querySelector('h2').innerText = "Game Paused";
                    } else {
                        overlay.classList.add('hidden');
                    }
                }
            } else if (data.status === 'finished') {
                if (gameState !== 'finished' || !document.querySelector('.bg-black.bg-opacity-80')) {
                    showGameOver(data, data.settings);
                    gameState = 'finished';
                }
            } else if (data.status === 'waiting') {
                if (gameState === 'finished' || gameState === 'playing') {
                    gameState = 'waiting';
                    resetSimState();
                    document.getElementById('death-overlay')?.remove();
                    document.querySelector('.bg-black.bg-opacity-80')?.remove();
                    enterLobbyUI(lobbyId, isHost);
                }
            }
        });
    },

    processGameState: function(parsed) {
        // Sync players
        simState.players.forEach(localP => {
            const serverPlayer = parsed.players.find(p => p.id === localP.id);
            if (serverPlayer) {
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

        // Sync Pending Queue (Remove processed requests)
        const me = simState.players.find(p => p.id === localPlayerId);
        if(me && me.spawnQueue) {
            const sIds = new Set(me.spawnQueue.map(i => i.reqId));
            if (typeof pendingQueue !== 'undefined') {
                pendingQueue = pendingQueue.filter(p => !sIds.has(p.reqId));
            }
        }

        // Sync Units
        const serverIds = new Set();
        parsed.units.forEach(serverUnit => {
            serverIds.add(serverUnit.id);
            if (renderState.units.has(serverUnit.id)) {
                const u = renderState.units.get(serverUnit.id);
                u.targetId = serverUnit.targetId;
                u.hp = serverUnit.hp;
                u.maxHp = serverUnit.maxHp;
                if (serverUnit.scale) u.scale = serverUnit.scale;
                
                const distSq = (u.x - serverUnit.x)**2 + (u.y - serverUnit.y)**2;
                if (distSq > 100 * 100) { 
                    u.x = serverUnit.x; 
                    u.y = serverUnit.y;
                }
            } else {
                renderState.units.set(serverUnit.id, { 
                    ...serverUnit, 
                    x: serverUnit.x, y: serverUnit.y, 
                    scale: serverUnit.scale || 1.0 
                });
            }
        });
        for (let [id, u] of renderState.units) { if (!serverIds.has(id)) renderState.units.delete(id); }
        simState.units = Array.from(renderState.units.values());

        // Sync Events
        if (parsed.events) {
            parsed.events.forEach(e => processSyncEvent(e));
        }
    },

    sendAction: function(data) {
        const now = Date.now();
        const reqId = localPlayerId + '_' + now + '_' + Math.random();
        
        // Prevent double-submission if user clicks fast
        if (this._lastActionTime && now - this._lastActionTime < 200) return;
        this._lastActionTime = now;
        
        // Block actions during connection phase
        if (gameState === 'connecting') return; 
        
        // Immediate local feedback for queueing
        if (data.type === 'queueUnit' && !isHost) {
            const p = simState.players.find(x => x.id === localPlayerId);
            const stats = getUnitStats(p.age, data.unitId);
            const cost = stats.cost * activeSettings.unitCost;
            if (p && stats && p.gold >= cost) {
                pendingQueue.push({ unitId: data.unitId, reqId: reqId, timestamp: now, cost: cost, startTime: now });
                updateUI();
            }
        }

        const payload = { ...data, playerId: localPlayerId, reqId: reqId };
        
        if (isHost) {
            processAction(payload);
        } else {
            // Try P2P First
            if (P2PManager.isConnected(simState.players.find(p => p.id !== localPlayerId && p.isBot === false /* Wait, find host */)?.id)) {
                 // Find Host ID? 
                 // We need to know who is host. P2PManager has connections, but we just send to host.
                 // Actually P2PManager.connections keys are peer IDs.
                 // The host ID is stored in lobby data but not globally accessible here easily unless we save it.
                 // Let's find host in players list.
            }
            
            // Simplification: We only connect to Host as client.
            // So broadcasting (sending to all connected) works if we only have 1 connection (to host).
            // OR explicitly find host.
            // For now, just send via P2PManager.send to 'host' if we knew the ID.
            // Let's use P2PManager.broadcast(payload) for client -> it sends to all connected (only host).
            
            // Wait, broadcast sends to ALL. Client only connects to Host. So broadcast is safe.
            const sent = P2PManager.send(simState.players.find(p => !p.isBot /* and isHost? */).id, { type: 'action', payload });
            
            // Actually, we can't rely on simState.players to know who is host easily without flag.
            // But in `subscribeToLobby`, we saw `data.hostId`. Let's store it globally or on P2PManager.
            // Hack: Clients only have 1 connection. Just send to that one?
            // P2PManager.broadcast({ type: 'action', payload });
            
            // Better:
            let hostId = null;
            // We can't access lobbyData scope here.
            // But we can iterate connections.
            for (let [pid, ctx] of P2PManager.connections) {
                P2PManager.send(pid, { type: 'action', payload });
            }
            
            // If no connections, fallback to Firestore? 
            // User wants to save bandwidth. If P2P fails, maybe alert?
            // For robustness, let's fallback if P2P fails.
            if (P2PManager.connections.size === 0) {
                 this.getLobbyRef().doc(lobbyId).collection('requests').add({ ...payload, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
            }
        }
    },

    fetchAndClearActions: async function() {
        // Host uses this. 
        // If using P2P, actions come via onP2PData -> processAction immediately.
        // So this is only for Fallback actions from Firestore.
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
        
        // Parse JSON to object to send via P2P (more efficient than double stringify)
        // But stateJSON is already string.
        // Let's send the object directly.
        const stateObj = JSON.parse(stateJSON);
        
        // Send via P2P
        P2PManager.broadcast({ type: 'state', payload: { ...stateObj, players: players } });

        // Do NOT write to Firestore to save bandwidth!
        // Only update heartbeat occasionally?
        // We need to update heartbeat so lobby doesn't die.
        // Update heartbeat every 10 seconds instead of every frame.
        const now = Date.now();
        if (!this.lastHeartbeat || now - this.lastHeartbeat > 10000) {
            this.lastHeartbeat = now;
             this.getLobbyRef().doc(lobbyId).update({ 
                // No stateJSON!
                lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp() 
            });
        }
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
        
        players.forEach(p => {
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
        
        P2PManager.connections.clear();
        
        // Start in "connecting" phase
        await this.getLobbyRef().doc(lobbyId).update({ 
            status: 'connecting',
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
         if (this.signalUnsub) this.signalUnsub();
         this.lobbyUnsub = null;
         this.signalUnsub = null;
         
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
