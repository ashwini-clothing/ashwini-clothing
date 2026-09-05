(() => {
  const button = document.getElementById('pwa-install-button');
  const section = document.getElementById('pwa-install-section');
  const help = document.getElementById('pwa-install-help');
  if (!button || !section || !help) return;
  const footerSection = document.getElementById('pwa-footer-section');
  const footerButton = document.getElementById('pwa-footer-button');
  const footerHelp = document.getElementById('pwa-footer-help');
  let pendingPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installedHere = false;
  try { installedHere = localStorage.getItem('ashwini-app-installed') === 'yes'; } catch {}
  let installTarget = null;
  const installed = () => installedHere || standalone.matches || navigator.standalone === true;
  let promptInProgress = false;
  const repeatDelay = 15 * 60 * 1000;
  const scheduleKey = 'ashwini-install-next-popup';
  let nextPopupAt = Date.now() + repeatDelay;
  let popupOpen = false, visibleUntil = 0, orderPending = false;
  const seenOrders = new Set();
  try {
    const saved = Number(localStorage.getItem(scheduleKey));
    if (saved > 0) nextPopupAt = Math.min(saved, nextPopupAt);
    else localStorage.setItem(scheduleKey, String(nextPopupAt));
  } catch {}
  const rememberInstalled = () => {
    installedHere = true;
    try { localStorage.setItem('ashwini-app-installed', 'yes'); } catch {}
  };
  if (standalone.matches || navigator.standalone === true) rememberInstalled();
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.className = 'pwa-popup-dismiss'; dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss install suggestion');
  button.innerHTML = '<img src="/app-icon-192.png?v=logo9-20260905" alt="" width="30" height="30"><span>Install Now</span>';
  button.setAttribute('aria-label', 'Install Ashwini App');
  button.removeAttribute('style'); help.removeAttribute('style');
  section.appendChild(dismiss); document.body.appendChild(section);
  section.className = 'pwa-install-popup'; section.hidden = true;
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
    const text = 'Install Now';
    if (label && label.textContent !== text) label.textContent = text;
    button.setAttribute('aria-label', pendingPrompt ? 'Install Ashwini App now' : 'How to install Ashwini App');
  };
  const sync = () => {
    const now = Date.now();
    if (footerSection) footerSection.hidden = installed() || !safePage();
    if (installed()) {
      popupOpen = false;
      orderPending = false;
    } else if (!safePage()) {
      popupOpen = false;
    } else {
      if (popupOpen && now >= visibleUntil && help.hidden && !promptInProgress) popupOpen = false;
      if (!promptInProgress && (orderPending || (!popupOpen && now >= nextPopupAt))) {
        popupOpen = true;
        visibleUntil = now + 20000;
        help.hidden = true;
        if (orderPending) {
          help.textContent = 'Order confirmed. Install Ashwini for quick access to shopping and order tracking.';
          help.hidden = false;
        }
        orderPending = false;
        nextPopupAt = now + repeatDelay;
        try { localStorage.setItem(scheduleKey, String(nextPopupAt)); } catch {}
      }
    }
    section.hidden = !popupOpen;
    if (!popupOpen) help.hidden = true;
  };
  dismiss.addEventListener('click', () => {
    popupOpen = false;
    help.hidden = true;
    sync();
  });
  window.addEventListener('ashwini:order-success', event => {
    const id = event.detail?.orderId;
    if (!id || seenOrders.has(String(id)) || installed()) return;
    seenOrders.add(String(id));
    orderPending = true;
    sync();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'ashwini-app-installed' && event.newValue === 'yes') rememberInstalled();
    if (event.key === scheduleKey && Number(event.newValue) > 0) nextPopupAt = Number(event.newValue);
    sync();
  });
  // Recheck payment state even when it changes without a DOM update.
  setInterval(sync, 1000);
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['style','class','open','aria-hidden']});
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => setTimeout(sync, 0));
  document.addEventListener('visibilitychange', sync);
  const instructions = (target = help) => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    target.textContent = ios
      ? 'On iPhone or iPad: open this website in Safari, tap Share, then Add to Home Screen and Add. Your Ashwini logo will appear on the Home Screen.'
      : 'Update your browser and then install again. Installation has not started from this button. Open this website directly in Chrome or Edge (not inside WhatsApp or Instagram). Open your browser menu and choose Install app, Install this site as an app, or Add to Home screen if available. On desktop, try Chrome or Edge. If already installed, open Ashwini from your apps.';
    target.hidden = false;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    updateLabel();
    help.hidden = true;
    sync();
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    // On Android this event can precede WebAPK installation; suppress repeat prompts only.
    rememberInstalled();
    popupOpen = false;
    orderPending = false;
    if (installTarget) {
      installTarget.textContent = 'Installation requested. Android may still be installing Ashwini. Check the Chrome notification and your apps list; this website cannot confirm when Android finishes. If installation does not complete: Update your browser and then install again.';
      installTarget.hidden = false;
    }
    section.hidden = true;
    if (footerSection) footerSection.hidden = true;
    if (typeof window.toast === 'function') window.toast('Installation requested. Check Chrome’s notification for progress.');
  });
  standalone.addEventListener('change', () => {
    if (standalone.matches) rememberInstalled();
    sync();
  });
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
          ? 'Install request accepted. Waiting for your browser to finish. If no Ashwini icon appears, check your apps list. If installation does not complete: Update your browser and then install again. You can also use the browser menu → Install app / Add to Home screen.'
          : 'Installation was cancelled. The app has not been installed by this request. You can try again from the browser menu.';
        target.hidden = false;
      }
    } catch {
      target.textContent = 'Installation could not start. Update your browser and then install again. If it still fails, try the browser menu → Install app / Add to Home screen.';
      target.hidden = false;
    }
    finally { promptInProgress = false; trigger.disabled = false; updateLabel(); }
  };
  button.addEventListener('click', () => install());
  footerButton?.addEventListener('click', () => {
    if (footerHelp && !installed()) return install(footerButton, footerHelp);
  });
  updateLabel();
  sync();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(error => console.warn('Ashwini offline support unavailable:', error));
  }
})();
