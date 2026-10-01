// Finds the newest Geranium release (tags finance_app-v…) and offers its installers,
// with the one for this computer first. If GitHub can't be reached, the button still
// opens the releases page.
(function () {
  var status = document.getElementById('status');
  var buttons = document.getElementById('buttons');
  var ua = navigator.userAgent;
  var mine = /Windows/.test(ua) ? 'windows' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Linux|X11/.test(ua) && !/Android/.test(ua) ? 'linux' : null;
  var KINDS = [
    { os: 'windows', test: /\.exe$/i, label: 'Windows (.exe)' },
    { os: 'mac', test: /\.dmg$/i, label: 'Mac — Apple silicon (.dmg)' },
    { os: 'linux', test: /\.deb$/i, label: 'Linux — Debian/Ubuntu (.deb)' },
    { os: 'linux', test: /\.AppImage$/i, label: 'Linux — AppImage' },
  ];
  var PREFIX = 'https://github.com/BearyNatural/claude/releases/download/';
  fetch('https://api.github.com/repos/BearyNatural/claude/releases?per_page=50', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (releases) {
      for (var i = 0; i < releases.length; i++) {
        var rel = releases[i];
        if (rel.draft || rel.tag_name.indexOf('finance_app-v') !== 0) continue;
        var found = [];
        KINDS.forEach(function (k) {
          var asset = rel.assets.filter(function (a) { return k.test.test(a.name) && a.browser_download_url.indexOf(PREFIX) === 0; })[0];
          if (asset) found.push({ kind: k, url: asset.browser_download_url });
        });
        if (!found.length) continue;
        found.sort(function (a, b) { return (b.kind.os === mine) - (a.kind.os === mine); });
        var version = rel.tag_name.replace(/^finance_app-v/, '').replace(/-build\d+$/, '');
        buttons.textContent = '';
        found.forEach(function (f, n) {
          var a = document.createElement('a');
          a.className = n === 0 && f.kind.os === mine ? 'button' : 'button secondary';
          a.href = f.url;
          a.textContent = f.kind.label;
          buttons.appendChild(a);
        });
        var sums = rel.assets.filter(function (a) { return a.name === 'SHA256SUMS.txt'; })[0];
        status.textContent = 'Version ' + version + (rel.prerelease ? ' (early release)' : '') + '. Choose the download for your computer.' + (sums ? ' (Optional: SHA256SUMS.txt on the release page lists a fingerprint for each file, so you can check a download arrived complete and unchanged.)' : '');
        return;
      }
      throw new Error('no release');
    })
    .catch(function () {
      status.textContent = 'Open the download page and choose the file for your computer under the newest Geranium version.';
    });
})();
