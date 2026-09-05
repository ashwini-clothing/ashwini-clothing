(() => {
  const button = document.getElementById('pwa-install-button');
  const section = document.getElementById('pwa-install-section');
  const help = document.getElementById('pwa-install-help');
  if (!button || !section || !help) return;
  let pendingPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const installed = () => standalone.matches || navigator.standalone === true;
  const sync = () => { section.hidden = installed(); };
  const instructions = () => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    help.textContent = ios
      ? 'On iPhone or iPad: open this website in Safari, tap Share, then Add to Home Screen and Add. Your Ashwini logo will appear on the Home Screen.'
      : 'Open your browser menu and choose Install app, Install this site as an app, or Add to Home screen if available. On desktop, try Chrome or Edge. If already installed, open Ashwini from your apps.';
    help.hidden = false;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    help.hidden = true;
    sync();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    section.hidden = true;
  });
  standalone.addEventListener('change', sync);
  button.addEventListener('click', async () => {
    if (!pendingPrompt) return instructions();
    const prompt = pendingPrompt;
    pendingPrompt = null;
    button.disabled = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') section.hidden = true;
    } catch { instructions(); }
    finally { button.disabled = false; }
  });
  sync();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(error => console.warn('Ashwini offline support unavailable:', error));
  }
})();
