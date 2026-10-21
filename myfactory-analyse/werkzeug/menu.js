async () => {
  // Liest NUR den Menübaum aus "Mein Menü verwalten" (keine Personendaten).
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CID = 'wf4ce1b65b-4644-4fd9-b1c6-cd3f6ba3ca6d';
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'width:1200px;height:900px';
  ifr.src = '/myfactory/ie50/system/workplace/Favorites/EditFavorites/EditFavoritesMain.aspx?ClientID=' + CID;
  document.body.appendChild(ifr);
  for (let i = 0; i < 30; i++) { await sleep(500); try { if (ifr.contentDocument.querySelector('tr[id^="tvtvwMain_tr"]')) break; } catch (e) {} }
  const f = ifr.contentWindow, d = ifr.contentDocument;
  if (!d || !d.querySelector('tr[id^="tvtvwMain_tr"]')) return 'KEIN BAUM: ' + (d ? d.location.href : '?');
  for (let p = 0; p < 9; p++) {
    const rows = [...d.querySelectorAll('tr.clsTreeNode[id^="tvtvwMain_tr"]')].filter(r => r.getAttribute('wfexpandable') == '-1' && r.getAttribute('wfexpanded') != '-1');
    if (!rows.length) break;
    rows.forEach(r => { try { f.gTreeNodeExpand('tvwMain', r.getAttribute('wfnodeid')); } catch (e) {} });
  }
  const rows = [...d.querySelectorAll('tr.clsTreeNode[id^="tvtvwMain_tr"]')];
  const lines = rows.map(r => '  '.repeat(+r.getAttribute('wflevel')) + r.innerText.trim());
  // rechte Liste = Favoriten des Benutzers (nur Menünamen)
  const fav = [...d.querySelectorAll('tr[wfitemid]')].map(r => r.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
  ifr.remove();
  return 'ZEILEN ' + rows.length + '\nFAVORITEN: ' + fav.join(' | ') + '\n\n' + lines.join('\n');
}
