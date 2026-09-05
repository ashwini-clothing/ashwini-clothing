(() => {
  const button = document.getElementById('pwa-install-button');
  const section = document.getElementById('pwa-install-section');
  const help = document.getElementById('pwa-install-help');
  if (!button || !section || !help) return;
  let pendingPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installedHere = false;
  // A saved flag cannot prove the app is still installed (it may have been removed).
  let installTarget = null;
  const installed = () => installedHere || standalone.matches || navigator.standalone === true;
  let promptInProgress = false;
  let eligible = false, browsingSeconds = 0, hasViewedProduct = false, snoozedUntil = 0;
  try { snoozedUntil = Number(localStorage.getItem('ashwini-install-snooze')) || 0; } catch {}
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.className = 'pwa-bubble-dismiss'; dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Hide install suggestion for 24 hours');
  button.innerHTML = '<img src="/app-icon-192.png" alt="" width="30" height="30"><span>How to install</span>';
  button.setAttribute('aria-label', 'Install Ashwini App');
  button.removeAttribute('style'); help.removeAttribute('style');
  section.appendChild(dismiss); document.body.appendChild(section);
  section.className = 'pwa-install-bubble'; section.hidden = true;
  const visible = node => !!node && node.getClientRects().length > 0;
  const safePage = () => {
    if (document.hidden || window.ashwiniPwaBusy?.() || visible(document.getElementById('behavior-consent')) || visible(document.getElementById('shopping-save-notice')) || visible(document.querySelector('.account-popover.open')) || visible(document.querySelector('#product-image-viewer.open')) || visible(document.querySelector('.razorpay-container')) || document.querySelector('dialog[open]')) return false;
    if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return false;
    const modal = document.getElementById('modal');
    if (!visible(modal)) return true;
    const body = document.getElementById('body');
    // Only known browsing screens are eligible; all other dialogs stay quiet.
    if (body?.querySelector('#payment,#placeOrderButton,#confirmReviewedOrderButton,.final-order-review,input[type="password"]')) return false;
    return !!body?.querySelector('.detail,.track,.order-detail-item,.success') || body?.querySelector('h2')?.textContent.trim() === 'Shopping Cart';
  };
  const updateLabel = () => {
    const label = button.querySelector('span');
    const text = pendingPrompt ? 'Install Now' : 'How to install';
    if (label && label.textContent !== text) label.textContent = text;
    button.setAttribute('aria-label', pendingPrompt ? 'Install Ashwini App now' : 'How to install Ashwini App');
  };
  const sync = () => {
    const hide = installed() || !eligible || Date.now() < snoozedUntil || !safePage();
    if (section.hidden !== hide) section.hidden = hide;
    if (hide && !help.hidden) help.hidden = true;
  };
  dismiss.addEventListener('click', () => {
    snoozedUntil = Date.now() + 86400000;
    try { localStorage.setItem('ashwini-install-snooze', String(snoozedUntil)); } catch {}
    sync();
  });
  window.addEventListener('ashwini:cart-added', () => { eligible = true; sync(); });
  // Count foreground shopping time only, starting at the first product view.
  setInterval(() => {
    if (visible(document.querySelector('#body .detail'))) hasViewedProduct = true;
    if (hasViewedProduct && safePage()) browsingSeconds++;
    if (browsingSeconds >= 120) eligible = true;
    sync();
  }, 1000);
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['style','class','open','aria-hidden']});
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => setTimeout(sync, 0));
  document.addEventListener('visibilitychange', sync);
  const instructions = (target = help) => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    target.textContent = ios
      ? 'On iPhone or iPad: open this website in Safari, tap Share, then Add to Home Screen and Add. Your Ashwini logo will appear on the Home Screen.'
      : 'Installation has not started from this button. Open this website directly in Chrome or Edge (not inside WhatsApp or Instagram). Open your browser menu and choose Install app, Install this site as an app, or Add to Home screen if available. On desktop, try Chrome or Edge. If already installed, open Ashwini from your apps.';
    target.hidden = false;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    updateLabel();
    installedHere = false;
    try { localStorage.removeItem('ashwini-app-installed'); } catch {}
    help.hidden = true;
    sync();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    installedHere = true;
    try { localStorage.setItem('ashwini-app-installed', 'yes'); } catch {}
    if (installTarget) {
      installTarget.textContent = 'Your browser confirmed installation. Look for Ashwini in your phone’s apps list or Home Screen. You can add it to the Home Screen from the apps list.';
      installTarget.hidden = false;
    }
    section.hidden = true;
    if (typeof window.toast === 'function') window.toast('Browser confirmed installation. Find Ashwini in your apps list.');
  });
  standalone.addEventListener('change', sync);
  const install = async (trigger = button, target = help) => {
    if (promptInProgress) return;
    installTarget = target;
    if (!pendingPrompt) return instructions(target);
    const prompt = pendingPrompt;
    pendingPrompt = null;
    trigger.disabled = true;
    promptInProgress = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (!installedHere) {
        target.textContent = choice.outcome === 'accepted'
          ? 'Install request accepted. Waiting for your browser to finish. If no Ashwini icon appears, check your apps list or use the browser menu → Install app / Add to Home screen.'
          : 'Installation was cancelled. The app has not been installed by this request. You can try again from the browser menu.';
        target.hidden = false;
      }
    } catch { instructions(target); }
    finally { promptInProgress = false; trigger.disabled = false; updateLabel(); }
  };
  button.addEventListener('click', () => install());
  // The bubble opens the browser prompt directly; no intermediate site dialog.
  window.addEventListener('ashwini:order-success', () => {
    eligible = true;
    sync();
    if (!section.hidden) {
      help.textContent = 'Order confirmed. Install Ashwini for quick access to order tracking.';
      help.hidden = false;
    }
  });
  updateLabel();
  sync();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(error => console.warn('Ashwini offline support unavailable:', error));
  }
})();
