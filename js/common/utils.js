function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2-x1)**2 + (y2-y1)**2);
}

function getUnitStats(ageIdx, unitId) {
    if (!GAME_DATA || !GAME_DATA.ages[ageIdx]) return null;
    for (const age of GAME_DATA.ages) {
        const u = age.units.find(x => x.id === unitId);
        if (u) return u;
    }
    return null;
}

function getTurretData(tid) {
    for(let a of GAME_DATA.ages) {
        if (a.turret && a.turret.id === tid) return a.turret;
    }
    return null;
}

function createPlayerObj(id, name, isBot, color) {
    return {
        id: id,
        name: name,
        isBot: isBot,
        age: 0,
        xp: 0,
        gold: 175,
        hp: 2500, 
        maxHp: 2500,
        turrets: [], 
        targetId: null, 
        color: color || `hsl(${Math.random() * 360}, 70%, 50%)`,
        spawnQueue: [], 
        spawnTimer: 0, 
        _visualTimer: 0, 
        specialCooldown: 0,
        team: 0 
    };
}

function isTeammate(p1Id, p2Id, players) {
    // Note: This needs 'players' list to be passed, or use global simState if available.
    // Refactored to take players list to be pure, or can default to global simState.players if defined
    if (typeof activeSettings !== 'undefined' && activeSettings.mode !== 'TEAMS') return false;
    
    let p1, p2;
    if (players) {
        p1 = players.find(p => p.id === p1Id);
        p2 = players.find(p => p.id === p2Id);
    } else if (typeof simState !== 'undefined') {
        p1 = simState.players.find(p => p.id === p1Id);
        p2 = simState.players.find(p => p.id === p2Id);
    }
    
    if (!p1 || !p2) return false;
    return p1.team === p2.team;
}


