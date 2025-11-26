window.addEventListener('DOMContentLoaded', () => { 
    initUI();
    AudioManager.init();
    // initRenderer(); // Will be called when game starts or if canvas is present
    if (window.Network) window.Network.initApp(); 
});

