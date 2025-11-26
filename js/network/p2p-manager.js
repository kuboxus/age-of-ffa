
// WebRTC Peer-to-Peer Manager
// Handles connections between Host and Clients to bypass Firebase for game loop data.

const P2PManager = {
    connections: new Map(), // Map<peerId, { conn: RTCPeerConnection, channel: RTCDataChannel, candidateQueue: [] }>
    myId: null,
    isHost: false,
    onDataReceived: null,
    signalCallback: null,
    
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    },

    init: function(myId, isHost, signalCallback, onDataReceived) {
        this.myId = myId;
        this.isHost = isHost;
        this.signalCallback = signalCallback;
        this.onDataReceived = onDataReceived;
        
        // Close existing connections on re-init
        this.connections.forEach(c => c.conn.close());
        this.connections.clear();
        
        console.log(`[P2P] Init as ${isHost ? 'HOST' : 'CLIENT'} (${myId})`);
    },

    // --- Connection Logic ---

    connectToPeer: async function(targetId) {
        if (this.connections.has(targetId)) {
            console.warn(`[P2P] Already connecting/connected to ${targetId}`);
            return;
        }
        console.log(`[P2P] Initiating connection to ${targetId}`);

        const conn = new RTCPeerConnection(this.config);
        const channel = conn.createDataChannel("game_updates", { ordered: false, maxRetransmits: 0 }); 
        
        this.setupConnectionHandlers(conn, targetId);
        this.setupChannelHandlers(channel, targetId);

        const context = { conn, channel, candidateQueue: [] };
        this.connections.set(targetId, context);

        try {
            const offer = await conn.createOffer();
            await conn.setLocalDescription(offer);
            this.signalCallback(targetId, { type: 'offer', sdp: offer });
        } catch (err) {
            console.error("[P2P] Error creating offer:", err);
        }
    },

    handleOffer: async function(senderId, offerData) {
        console.log(`[P2P] Received offer from ${senderId}`);
        
        let context = this.connections.get(senderId);
        if (!context) {
            const conn = new RTCPeerConnection(this.config);
            this.setupConnectionHandlers(conn, senderId);
            
            conn.ondatachannel = (e) => {
                console.log(`[P2P] Received Data Channel from ${senderId}`);
                this.setupChannelHandlers(e.channel, senderId);
                if (context) context.channel = e.channel;
            };
            
            context = { conn, channel: null, candidateQueue: [] };
            this.connections.set(senderId, context);
            
            // Check for pre-queued candidates
            this.checkPendingCandidates(senderId, context);
        }

        try {
            // Need to be in "stable" or "have-local-offer" state usually, but here we are "new" or "have-remote-offer"
            await context.conn.setRemoteDescription(new RTCSessionDescription(offerData));
            
            // Process queued candidates now that remote description is set
            if (context.candidateQueue.length > 0) {
                console.log(`[P2P] Processing ${context.candidateQueue.length} queued candidates from ${senderId}`);
                for (const cand of context.candidateQueue) {
                    await context.conn.addIceCandidate(new RTCIceCandidate(cand));
                }
                context.candidateQueue = [];
            }

            const answer = await context.conn.createAnswer();
            await context.conn.setLocalDescription(answer);
            
            this.signalCallback(senderId, { type: 'answer', sdp: answer });
        } catch (err) {
            console.error("[P2P] Error handling offer:", err);
        }
    },

    handleAnswer: async function(senderId, answerData) {
        console.log(`[P2P] Received answer from ${senderId}`);
        const context = this.connections.get(senderId);
        if (context) {
            try {
                await context.conn.setRemoteDescription(new RTCSessionDescription(answerData));
                
                // Also process queued candidates if any (though less likely for caller)
                if (context.candidateQueue && context.candidateQueue.length > 0) {
                    console.log(`[P2P] Processing ${context.candidateQueue.length} queued candidates from ${senderId}`);
                    for (const cand of context.candidateQueue) {
                        await context.conn.addIceCandidate(new RTCIceCandidate(cand));
                    }
                    context.candidateQueue = [];
                }
            } catch (err) {
                console.error("[P2P] Error handling answer:", err);
            }
        } else {
            console.warn(`[P2P] Received answer from unknown peer ${senderId}`);
        }
    },

    handleCandidate: async function(senderId, candidateData) {
        // If context doesn't exist yet (offer hasn't arrived), we must create a temporary placeholder or wait?
        // Actually, we can create the context object with null conn? No, we need conn to be created when offer arrives.
        // Strategy: If no context, create a "pending" context or just store in a separate map?
        // Easier: Just store in a separate pending map if connection doesn't exist.
        
        let context = this.connections.get(senderId);
        
        if (!context) {
            console.log(`[P2P] Queuing candidate from ${senderId} (No connection yet)`);
            // Create a temporary context placeholder just for queue? 
            // Or better, `handleOffer` logic handles creation. 
            // Let's use a static map for "orphaned" candidates?
            if (!this.pendingCandidates) this.pendingCandidates = new Map();
            if (!this.pendingCandidates.has(senderId)) this.pendingCandidates.set(senderId, []);
            this.pendingCandidates.get(senderId).push(candidateData);
            return;
        }

        // If connection exists but remote description not set, we queue inside context
        if (!context.conn.remoteDescription) {
             console.log(`[P2P] Queuing candidate from ${senderId} (Remote description not set)`);
             if (!context.candidateQueue) context.candidateQueue = [];
             context.candidateQueue.push(candidateData);
             return;
        }

        try {
            await context.conn.addIceCandidate(new RTCIceCandidate(candidateData));
            console.log(`[P2P] Added ICE candidate from ${senderId}`);
        } catch (e) {
            console.error("[P2P] Error adding ice candidate", e);
        }
    },
    
    // Helper to check pending candidates when context is created
    checkPendingCandidates: async function(senderId, context) {
        if (this.pendingCandidates && this.pendingCandidates.has(senderId)) {
            const queue = this.pendingCandidates.get(senderId);
            console.log(`[P2P] Processing ${queue.length} pre-queued candidates for ${senderId}`);
            context.candidateQueue = (context.candidateQueue || []).concat(queue);
            this.pendingCandidates.delete(senderId);
        }
    },

    setupConnectionHandlers: function(conn, peerId) {
        conn.onicecandidate = (e) => {
            if (e.candidate) {
                this.signalCallback(peerId, { type: 'candidate', candidate: e.candidate });
            }
        };

        conn.onconnectionstatechange = () => {
            console.log(`[P2P] Connection state with ${peerId}: ${conn.connectionState}`);
            if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed' || conn.connectionState === 'closed') {
                // Optional: Try to reconnect?
                // this.connections.delete(peerId); // Don't delete immediately, maybe temporary?
            }
        };
        
        conn.oniceconnectionstatechange = () => {
            console.log(`[P2P] ICE state with ${peerId}: ${conn.iceConnectionState}`);
        };
    },

    setupChannelHandlers: function(channel, peerId) {
        channel.onopen = () => {
            console.log(`[P2P] Data Channel OPEN with ${peerId}`);
        };
        channel.onmessage = (e) => {
            if (this.onDataReceived) {
                try {
                    const data = JSON.parse(e.data);
                    this.onDataReceived(peerId, data);
                } catch(err) {
                    console.error("P2P Parse Error", err);
                }
            }
        };
        channel.onerror = (err) => console.error("[P2P] Channel Error:", err);
    },

    broadcast: function(data) {
        const msg = JSON.stringify(data);
        this.connections.forEach(ctx => {
            if (ctx.channel && ctx.channel.readyState === 'open') {
                ctx.channel.send(msg);
            }
        });
    },

    send: function(targetId, data) {
        const ctx = this.connections.get(targetId);
        if (ctx && ctx.channel && ctx.channel.readyState === 'open') {
            ctx.channel.send(JSON.stringify(data));
            return true;
        }
        return false;
    },
    
    // Helper: Count active connections
    getConnectionCount: function() {
        let count = 0;
        this.connections.forEach(c => {
            if (c.channel && c.channel.readyState === 'open') count++;
        });
        return count;
    }
};
