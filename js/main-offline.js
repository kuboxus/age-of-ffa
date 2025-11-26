window.addEventListener('DOMContentLoaded', () => { 
    initUI();
    AudioManager.init();
    // initRenderer(); // Will be called when game starts
    if (window.Network) window.Network.initApp(); 
});

