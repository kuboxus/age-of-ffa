let localPlayerId = null;
let lobbyId = null;
let isHost = false;
let activeSettings = null; // Will be initialized with DEFAULT_SETTINGS logic
let lobbySettings = null;
let gameLoopRef = null;
let pendingQueue = []; 
