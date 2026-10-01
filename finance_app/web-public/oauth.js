// Google returns here after sign-in. Hand the result to the Geranium tab (same site, this
// browser only), remove it from the address bar, and close this window.
(function () {
  var hash = location.hash;
  history.replaceState(null, '', location.pathname);
  var msg = document.getElementById('msg');
  try {
    var channel = new BroadcastChannel('geranium-oauth');
    channel.postMessage({ hash: hash });
    channel.close();
    msg.textContent = /error=/.test(hash) ? 'Google sign-in was cancelled. You can close this window.' : 'Connected. You can close this window and go back to Geranium.';
  } catch (e) {
    msg.textContent = 'This browser could not pass the sign-in back to Geranium. Please use a current version of Firefox, Chrome, Edge or Safari.';
  }
  setTimeout(function () { window.close(); }, 600);
})();
