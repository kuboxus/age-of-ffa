
// WebRTC Peer-to-Peer Manager
// Handles connections between Host and Clients to bypass Firebase for game loop data.

const P2PManager = {
    connections: new Map(), // Map<peerId, { conn: RTCPeerConnection, channel: RTCDataChannel }>
    myId: null,
    isHost: false,
    onDataReceived: null, // Callback for incoming data
    signalCallback: null, // Callback to send signaling data via Firebase
    
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
        this.connections.clear();
        console.log(`[P2P] Init as ${isHost ? 'HOST' : 'CLIENT'} (${myId})`);
    },

    // --- Connection Logic ---

    // Host calls this to connect to a new client
    connectToPeer: async function(targetId) {
        if (this.connections.has(targetId)) return;
        console.log(`[P2P] Initiating connection to ${targetId}`);

        const conn = new RTCPeerConnection(this.config);
        const channel = conn.createDataChannel("game_updates", { ordered: false, maxRetransmits: 0 }); // UDP-like
        
        this.setupConnectionHandlers(conn, targetId);
        this.setupChannelHandlers(channel, targetId);

        const context = { conn, channel };
        this.connections.set(targetId, context);

        // Create Offer
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
        this.signalCallback(targetId, { type: 'offer', sdp: offer });
    },

    // Client calls this when receiving an offer
    handleOffer: async function(senderId, offerData) {
        console.log(`[P2P] Received offer from ${senderId}`);
        
        let context = this.connections.get(senderId);
        if (!context) {
            const conn = new RTCPeerConnection(this.config);
            this.setupConnectionHandlers(conn, senderId);
            
            // Client waits for data channel from Host
            conn.ondatachannel = (e) => {
                console.log(`[P2P] Received Data Channel from ${senderId}`);
                this.setupChannelHandlers(e.channel, senderId);
                if (context) context.channel = e.channel;
            };
            
            context = { conn, channel: null };
            this.connections.set(senderId, context);
        }

        await context.conn.setRemoteDescription(new RTCSessionDescription(offerData));
        const answer = await context.conn.createAnswer();
        await context.conn.setLocalDescription(answer);
        
        this.signalCallback(senderId, { type: 'answer', sdp: answer });
    },

    handleAnswer: async function(senderId, answerData) {
        console.log(`[P2P] Received answer from ${senderId}`);
        const context = this.connections.get(senderId);
        if (context) {
            await context.conn.setRemoteDescription(new RTCSessionDescription(answerData));
        }
    },

    handleCandidate: async function(senderId, candidateData) {
        const context = this.connections.get(senderId);
        if (context && context.conn) {
            try {
                await context.conn.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
                console.error("Error adding ice candidate", e);
            }
        }
    },

    // --- Handlers ---

    setupConnectionHandlers: function(conn, peerId) {
        conn.onicecandidate = (e) => {
            if (e.candidate) {
                this.signalCallback(peerId, { type: 'candidate', candidate: e.candidate });
            }
        };

        conn.onconnectionstatechange = () => {
            console.log(`[P2P] Connection with ${peerId}: ${conn.connectionState}`);
            if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed') {
                this.connections.delete(peerId);
            }
        };
    },

    setupChannelHandlers: function(channel, peerId) {
        channel.onopen = () => {
            console.log(`[P2P] Data Channel OPEN with ${peerId}`);
            // Optional: Send a ping or handshake
        };
        channel.onmessage = (e) => {
            if (this.onDataReceived) {
                // Handle both string (JSON) and binary (if we optimize later)
                try {
                    const data = JSON.parse(e.data);
                    this.onDataReceived(peerId, data);
                } catch(err) {
                    console.error("P2P Parse Error", err);
                }
            }
        };
    },

    // --- Sending Data ---

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
    
    isConnected: function(targetId) {
        const ctx = this.connections.get(targetId);
        return ctx && ctx.channel && ctx.channel.readyState === 'open';
    }
};

