(() => {
  const button = document.getElementById('pwa-install-button');
  const section = document.getElementById('pwa-install-section');
  const help = document.getElementById('pwa-install-help');
  if (!button || !section || !help) return;
  let pendingPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installedHere = false;
  try { installedHere = localStorage.getItem('ashwini-app-installed') === 'yes'; } catch {}
  const installed = () => installedHere || standalone.matches || navigator.standalone === true;
  let orderDialog;
  const shownOrders = new Set();
  const sync = () => { section.hidden = installed(); };
  const instructions = (target = help) => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    target.textContent = ios
      ? 'On iPhone or iPad: open this website in Safari, tap Share, then Add to Home Screen and Add. Your Ashwini logo will appear on the Home Screen.'
      : 'Open your browser menu and choose Install app, Install this site as an app, or Add to Home screen if available. On desktop, try Chrome or Edge. If already installed, open Ashwini from your apps.';
    target.hidden = false;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    help.hidden = true;
    sync();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    installedHere = true;
    try { localStorage.setItem('ashwini-app-installed', 'yes'); } catch {}
    section.hidden = true;
    if (orderDialog?.open) orderDialog.close();
  });
  standalone.addEventListener('change', sync);
  const install = async (trigger = button, target = help) => {
    if (!pendingPrompt) return instructions(target);
    const prompt = pendingPrompt;
    pendingPrompt = null;
    trigger.disabled = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') { section.hidden = true; if (orderDialog?.open) orderDialog.close(); }
    } catch { instructions(target); }
    finally { trigger.disabled = false; }
  };
  button.addEventListener('click', () => install());
  window.addEventListener('ashwini:order-success', event => {
    const id = String(event.detail?.orderId || '');
    if (!id || installed() || shownOrders.has(id) || orderDialog?.open) return;
    shownOrders.add(id);
    orderDialog = document.createElement('dialog');
    orderDialog.setAttribute('aria-labelledby', 'order-install-title');
    orderDialog.setAttribute('aria-describedby', 'order-install-description');
    orderDialog.style.cssText = 'width:min(420px,calc(100vw - 48px));max-height:85vh;overflow:auto;box-sizing:border-box;border:0;border-radius:18px;padding:26px;text-align:center;color:#5a2e40;background:#fff;box-shadow:0 18px 65px #0005';
    orderDialog.innerHTML = `<img src="/app-icon-192.png" alt="Ashwini" width="72" height="72" style="border-radius:15px"><p style="font-weight:bold;color:#267443">✓ Order confirmed</p><h2 id="order-install-title">Track your order easily</h2><p id="order-install-description" style="line-height:1.6">Install the Ashwini App for quick access to My Orders and delivery updates. You can also track your order on the website.</p><button type="button" data-install style="min-height:44px;width:100%;background:#5a2e40;color:white;border:0;border-radius:9px;padding:12px;font-weight:bold;cursor:pointer">Install Ashwini App</button><p data-help role="status" hidden style="line-height:1.6"></p><button type="button" data-later style="min-height:44px;margin-top:10px;background:white;color:#5a2e40;border:0;cursor:pointer">Not now</button>`;
    const previousFocus = document.activeElement;
    orderDialog.querySelector('[data-install]').addEventListener('click', event => install(event.currentTarget, orderDialog.querySelector('[data-help]')));
    orderDialog.querySelector('[data-later]').addEventListener('click', () => orderDialog.close());
    orderDialog.addEventListener('close', () => { orderDialog.remove(); previousFocus?.focus(); }, {once:true});
    document.body.appendChild(orderDialog);
    orderDialog.showModal();
  });
  sync();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(error => console.warn('Ashwini offline support unavailable:', error));
  }
})();
