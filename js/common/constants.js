// --- Configuration ---
const VERSION = "v3.3-Refactored";

// Default Gameplay Settings
const DEFAULT_SETTINGS = {
    mode: 'FFA', // 'FFA' or 'TEAMS'
    gameSpeed: 1.0,
    unitCost: 1.0,
    goldMult: 1.0,
    xpMult: 1.0,
    baseHp: 2500,
    xpReq: 1.0,
    layout: 'alternating' // 'together' or 'alternating' (checkerboard)
};

const TEAMS = {
    1: { name: "Blue Team", color: "#3b82f6" },
    2: { name: "Red Team", color: "#ef4444" }
};

const GAME_DATA = {
    ages: [
        {
            name: "Stone Age",
            xpReq: 0,
            special: { name: "Meteor Strike", damage: 200, radius: 100, cooldown: 60 },
            units: [
                { id: 'u1_1', name: "Club Man", icon: "🪨", cost: 15, delay: 1.0, hp: 55, meleeDmg: 16, rangedDmg: 0, meleeRange: 20, rangedRange: 0 },
                { id: 'u1_2', name: "Slingshot Man", icon: "🧶", cost: 25, delay: 1.0, hp: 42, meleeDmg: 10, rangedDmg: 8, meleeRange: 20, rangedRange: 100 },
                { id: 'u1_3', name: "Dino Rider", icon: "🦖", cost: 100, delay: 3.0, hp: 160, meleeDmg: 40, rangedDmg: 0, meleeRange: 45, rangedRange: 0, scale: 1.5 }
            ],
            turret: { id: 't1', name: "Rock Catapult", icon: "🪵", cost: 100, damage: 20, range: 180, cooldown: 120 }
        },
        {
            name: "Medieval Age",
            xpReq: 1000,
            special: { name: "Arrow Rain", damage: 400, radius: 120, cooldown: 70 },
            units: [
                { id: 'u2_1', name: "Sword Man", icon: "⚔️", cost: 50, delay: 2.0, hp: 100, meleeDmg: 32, rangedDmg: 0, meleeRange: 20, rangedRange: 0 },
                { id: 'u2_2', name: "Archer", icon: "🏹", cost: 75, delay: 1.0, hp: 80, meleeDmg: 20, rangedDmg: 9, meleeRange: 20, rangedRange: 130 },
                { id: 'u2_3', name: "Knight", icon: "🐴", cost: 500, delay: 3.0, hp: 300, meleeDmg: 60, rangedDmg: 0, meleeRange: 60, rangedRange: 0, scale: 1.5 }
            ],
            turret: { id: 't2', name: "Ballista", icon: "🏹", cost: 400, damage: 35, range: 220, cooldown: 100 }
        },
        {
            name: "Renaissance",
            xpReq: 4000,
            special: { name: "Artillery Strike", damage: 800, radius: 150, cooldown: 80 },
            units: [
                { id: 'u3_1', name: "Duelist", icon: "🗡️", cost: 200, delay: 3.0, hp: 200, meleeDmg: 79, rangedDmg: 0, meleeRange: 25, rangedRange: 0 },
                { id: 'u3_2', name: "Musketeer", icon: "🔫", cost: 400, delay: 3.0, hp: 160, meleeDmg: 40, rangedDmg: 20, meleeRange: 25, rangedRange: 130 },
                { id: 'u3_3', name: "Cannoneer", icon: "💣", cost: 1000, delay: 5.0, hp: 600, meleeDmg: 120, rangedDmg: 0, meleeRange: 25, rangedRange: 0 }
            ],
            turret: { id: 't3', name: "Cannon Turret", icon: "💣", cost: 1000, damage: 90, range: 260, cooldown: 160 }
        },
        {
            name: "Modern Age",
            xpReq: 16000,
            special: { name: "Airstrike", damage: 1500, radius: 180, cooldown: 90 },
            units: [
                { id: 'u4_1', name: "Melee Infantry", icon: "🎖️", cost: 1500, delay: 3.0, hp: 300, meleeDmg: 100, rangedDmg: 0, meleeRange: 25, rangedRange: 0 },
                { id: 'u4_2', name: "Machine Gunner", icon: "🔫", cost: 2000, delay: 3.0, hp: 350, meleeDmg: 60, rangedDmg: 30, meleeRange: 25, rangedRange: 130 }, 
                { id: 'u4_3', name: "Tank", icon: "🚜", cost: 7000, delay: 8.0, hp: 1200, meleeDmg: 300, rangedDmg: 0, meleeRange: 100, rangedRange: 0, scale: 1.5 }
            ],
            turret: { id: 't4', name: "Machine Gun", icon: "🔫", cost: 4000, damage: 35, range: 280, cooldown: 15 }
        },
        {
            name: "Future Age",
            xpReq: 60000,
            special: { name: "Ion Cannon", damage: 6000, radius: 250, cooldown: 120 },
            units: [
                { id: 'u5_1', name: "Alien Blade", icon: "👽", cost: 5000, delay: 3.0, hp: 1000, meleeDmg: 250, rangedDmg: 0, meleeRange: 40, rangedRange: 0 },
                { id: 'u5_2', name: "Alien Blaster", icon: "⚡", cost: 6000, delay: 3.0, hp: 800, meleeDmg: 130, rangedDmg: 80, meleeRange: 40, rangedRange: 130 },
                { id: 'u5_3', name: "War Machine", icon: "👹", cost: 20000, delay: 8.0, hp: 3000, meleeDmg: 600, rangedDmg: 0, meleeRange: 100, rangedRange: 0, scale: 1.5 },
                { id: 'u5_4', name: "Super Soldier", icon: "🦸", cost: 150000, delay: 3.0, hp: 4000, meleeDmg: 400, rangedDmg: 400, meleeRange: 40, rangedRange: 150 }
            ],
            turret: { id: 't5', name: "Laser Battery", icon: "⚡", cost: 15000, damage: 500, range: 350, cooldown: 80 }
        }
    ],
    turretSlots: 2,
    mapRadius: 1000,
    baseRadius: 90, 
    unitCollisionRadius: 20 
};

