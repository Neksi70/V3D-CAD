async () => {
  // Liest NUR Konfigurations-Stammdaten (Grundlagen) aus – keine Kunden/Adressen/Belege.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CID = 'wf4ce1b65b-4644-4fd9-b1c6-cd3f6ba3ca6d';
  const WANT = [
    'Projekte > Grundlagen > Projektphasen',
    'Projekte > Grundlagen > Projektgruppen',
    'Projekte > Grundlagen > Konfiguration',
    'Projekte > Grundlagen > Zeiterfassungsaktivitäten',
    'Projekte > Grundlagen > Zeiterfassungstypen',
    'Stammdaten > Grundlagen > Belegverarbeitung > Verkaufsbelegarten',
    'Stammdaten > Grundlagen > Belegverarbeitung > Einkaufsbelegarten',
    'Verkauf > Grundlagen > Belegstatuswerte',
    'Einkauf > Grundlagen > Belegstatuswerte',
    'Stammdaten > Grundlagen > Zahlung > Zahlungskonditionen',
    'Stammdaten > Grundlagen > Lieferung > Versandarten',
    'Stammdaten > Grundlagen > Lieferung > Lieferbedingungen',
    'Stammdaten > Grundlagen > Stammdaten > Artikel > Mengeneinheiten',
    'Stammdaten > Grundlagen > Allgemein > Kennzeichen',
    'Stammdaten > Gruppen > Artikelgruppen',
    'Produktion > Grundlagen > Auftragstypen'
  ];
  const mk = (src) => { const i = document.createElement('iframe'); i.style.cssText = 'width:1400px;height:1000px'; i.src = src; document.body.appendChild(i); return i; };
  // 1) Befehle aus dem Menübaum holen
  const fav = mk('/myfactory/ie50/system/workplace/Favorites/EditFavorites/EditFavoritesMain.aspx?ClientID=' + CID);
  for (let i = 0; i < 30; i++) { await sleep(500); try { if (fav.contentDocument.querySelector('tr[id^="tvtvwMain_tr"]')) break; } catch (e) {} }
  const fd = fav.contentDocument, fw = fav.contentWindow;
  for (let p = 0; p < 9; p++) { const rows = [...fd.querySelectorAll('tr.clsTreeNode[id^="tvtvwMain_tr"]')].filter(r => r.getAttribute('wfexpandable') == '-1' && r.getAttribute('wfexpanded') != '-1'); if (!rows.length) break; rows.forEach(r => { try { fw.gTreeNodeExpand('tvwMain', r.getAttribute('wfnodeid')); } catch (e) {} }); }
  const path = [], cmds = {};
  [...fd.querySelectorAll('tr.clsTreeNode[id^="tvtvwMain_tr"]')].forEach(r => { const lv = +r.getAttribute('wflevel'); path[lv] = r.innerText.trim(); path.length = lv + 1; const c = r.getAttribute('wfnodedata'); if (c) cmds[path.join(' > ')] = c; });
  fav.remove();
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\s+/g, ' ').trim();
  const labels = (d) => { const out = []; d.querySelectorAll('input,select,textarea').forEach(el => { if (el.type === 'hidden') return; let lab = ''; const td = el.closest('td'); if (td) { let p = td.previousElementSibling; while (p && !txt(p)) p = p.previousElementSibling; if (p) lab = txt(p).slice(0, 50); } if (!lab && (el.type === 'checkbox')) { const t2 = td && td.nextElementSibling; lab = txt(t2).slice(0, 50); } if (lab && !/Filter|Suche/.test(lab)) out.push(lab); }); return [...new Set(out)]; };
  const res = [];
  for (const k of WANT) {
    const c = cmds[k]; if (!c) { res.push('## ' + k + '\n(nicht im Menü)'); continue; }
    let [page, cmd] = c.split('$;$'); page = page.replace(/\.asp(\?|$)/i, '.aspx$1');
    const fr = mk('/myfactory/ie50/' + page + (page.includes('?') ? '&' : '?') + 'ClientID=' + CID + '&WorkplaceCall=-1&MFWorkplaceCmdName=' + cmd);
    for (let i = 0; i < 24; i++) { await sleep(500); try { if (fr.contentDocument.readyState === 'complete' && fr.contentDocument.body && fr.contentDocument.body.innerText.length > 50) break; } catch (e) {} }
    await sleep(1200);
    const d = fr.contentDocument;
    const rows = [...d.querySelectorAll('tr[id="trItem_lstMain"]')].map(r => txt(r)).filter(Boolean);
    const tabs = [...d.querySelectorAll('td[name="tabPage_tabHeader"]')].map(t => txt(t));
    res.push('## ' + k + ' [' + cmd + ']\nWerte (' + rows.length + '): ' + rows.slice(0, 80).join(' ; ') + (tabs.length ? '\nReiter: ' + tabs.join(' | ') : '') + '\nFelder: ' + labels(d).join(' | '));
    fr.remove();
  }
  return res.join('\n\n');
}
